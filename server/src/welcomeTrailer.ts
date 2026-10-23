// Welcome trailer: one video every account sees once (see onboarding.js).
// The files are operator data in config.welcomeTrailerDir; admins upload and
// replace them in the app, so nobody needs shell access to the server.

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform, type Readable } from 'stream';
import { nanoid } from 'nanoid';
import { config } from './config';
import { db, getState, setState } from './db';

export const WELCOME_TRAILER_VIDEO = 'welcome-trailer.mp4';
export const WELCOME_TRAILER_POSTER = 'welcome-trailer-poster.jpg';

const ENABLED_STATE_KEY = 'welcome_trailer_enabled';

export type WelcomeTrailerAsset = 'video' | 'poster';

interface AssetRule {
  file: string;
  contentType: string;
  maxBytes: number;
  label: string;
  // A cheap content check against renamed files: MP4 carries "ftyp" at byte 4,
  // JPEG starts with FF D8 FF.
  matches: (head: Buffer) => boolean;
}

export const WELCOME_TRAILER_ASSETS: Record<WelcomeTrailerAsset, AssetRule> = {
  video: {
    file: WELCOME_TRAILER_VIDEO,
    contentType: 'video/mp4',
    maxBytes: 95 * 1024 * 1024,
    label: 'MP4-Video',
    matches: (head) => head.length >= 8 && head.subarray(4, 8).toString('latin1') === 'ftyp',
  },
  poster: {
    file: WELCOME_TRAILER_POSTER,
    contentType: 'image/jpeg',
    maxBytes: 5 * 1024 * 1024,
    label: 'JPEG-Bild',
    matches: (head) => head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  },
};

export interface WelcomeTrailerState {
  available: boolean;
  hasPoster: boolean;
  seen: boolean;
}

export interface WelcomeTrailerFileInfo {
  size: number;
  updatedAt: number;
}

export interface WelcomeTrailerAdminStatus {
  storage: boolean;
  enabled: boolean;
  video: WelcomeTrailerFileInfo | null;
  poster: WelcomeTrailerFileInfo | null;
  seenCount: number;
  accountCount: number;
}

export class WelcomeTrailerUploadError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function fileInfo(name: string): (WelcomeTrailerFileInfo & { file: string }) | null {
  if (!config.welcomeTrailerDir) return null;
  const file = path.join(config.welcomeTrailerDir, name);
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? { file, size: stat.size, updatedAt: Math.round(stat.mtimeMs) } : null;
  } catch {
    return null;
  }
}

export function welcomeTrailerFile(asset: WelcomeTrailerAsset): string | null {
  return fileInfo(WELCOME_TRAILER_ASSETS[asset].file)?.file ?? null;
}

// Missing means on: an installation that never touched the switch shows the
// trailer as soon as a video exists, as it did before the switch existed.
export function welcomeTrailerEnabled(): boolean {
  return getState(ENABLED_STATE_KEY) !== '0';
}

export function setWelcomeTrailerEnabled(enabled: boolean): void {
  setState(ENABLED_STATE_KEY, enabled ? '1' : '0');
}

// Admin-seeded test players count as having seen it: an admin opening a test
// session wants to check a view, not watch the trailer once per test player.
export function welcomeTrailerState(playerId: string): WelcomeTrailerState {
  const row = db.prepare('SELECT welcome_trailer_seen_at, is_test FROM players WHERE id = ?').get(playerId) as
    | { welcome_trailer_seen_at: number | null; is_test: number }
    | undefined;
  return {
    available: welcomeTrailerEnabled() && welcomeTrailerFile('video') !== null,
    hasPoster: welcomeTrailerFile('poster') !== null,
    seen: row?.welcome_trailer_seen_at != null || row?.is_test === 1,
  };
}

// COALESCE keeps the first time: repeated or parallel closes from several
// devices all succeed without overwriting it.
export function markWelcomeTrailerSeen(playerId: string): void {
  db.prepare('UPDATE players SET welcome_trailer_seen_at = COALESCE(welcome_trailer_seen_at, ?) WHERE id = ?')
    .run(Date.now(), playerId);
}

// Real, active accounts only: test players never get the trailer anyway.
export function resetWelcomeTrailerSeen(): number {
  return db
    .prepare('UPDATE players SET welcome_trailer_seen_at = NULL WHERE is_test = 0 AND welcome_trailer_seen_at IS NOT NULL')
    .run().changes;
}

export function welcomeTrailerAdminStatus(): WelcomeTrailerAdminStatus {
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS accountCount, COUNT(welcome_trailer_seen_at) AS seenCount
       FROM players WHERE is_test = 0 AND deactivated_at IS NULL`,
    )
    .get() as { accountCount: number; seenCount: number };
  const info = (name: string): WelcomeTrailerFileInfo | null => {
    const found = fileInfo(name);
    return found ? { size: found.size, updatedAt: found.updatedAt } : null;
  };
  return {
    storage: Boolean(config.welcomeTrailerDir),
    enabled: welcomeTrailerEnabled(),
    video: info(WELCOME_TRAILER_VIDEO),
    poster: info(WELCOME_TRAILER_POSTER),
    seenCount: counts.seenCount,
    accountCount: counts.accountCount,
  };
}

// Streams an upload into a private temporary file and only then renames it
// over the live file. A broken or oversized upload never replaces a working
// trailer, and parallel uploads each finish a complete file: the last rename
// wins, nobody ever reads a half-written video.
export async function storeWelcomeTrailerAsset(
  asset: WelcomeTrailerAsset,
  body: Readable,
  declaredLength: number | null,
): Promise<void> {
  const rule = WELCOME_TRAILER_ASSETS[asset];
  if (!config.welcomeTrailerDir) {
    throw new WelcomeTrailerUploadError(409, 'Auf diesem Server ist kein Speicherort für den Trailer eingerichtet.');
  }
  if (declaredLength !== null && declaredLength > rule.maxBytes) {
    throw new WelcomeTrailerUploadError(413, `Die Datei ist zu groß (höchstens ${Math.round(rule.maxBytes / 1024 / 1024)} MB).`);
  }
  fs.mkdirSync(config.welcomeTrailerDir, { recursive: true });
  const target = path.join(config.welcomeTrailerDir, rule.file);
  const temp = path.join(config.welcomeTrailerDir, `.${rule.file}.${nanoid(8)}.upload`);
  let received = 0;
  const head: Buffer[] = [];
  let headLength = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > rule.maxBytes) {
        callback(new WelcomeTrailerUploadError(413, `Die Datei ist zu groß (höchstens ${Math.round(rule.maxBytes / 1024 / 1024)} MB).`));
        return;
      }
      if (headLength < 12) {
        head.push(chunk.subarray(0, 12 - headLength));
        headLength += Math.min(chunk.length, 12 - headLength);
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(body, limit, fs.createWriteStream(temp, { flags: 'wx' }));
    if (received === 0) throw new WelcomeTrailerUploadError(400, 'Die Datei ist leer.');
    if (!rule.matches(Buffer.concat(head))) {
      throw new WelcomeTrailerUploadError(400, `Die Datei ist kein ${rule.label}.`);
    }
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    if (error instanceof WelcomeTrailerUploadError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET' || code === 'ECONNABORTED') {
      throw new WelcomeTrailerUploadError(400, 'Der Upload wurde abgebrochen.');
    }
    throw new WelcomeTrailerUploadError(500, 'Die Datei konnte nicht gespeichert werden.');
  }
}

export function removeWelcomeTrailerAssets(): void {
  if (!config.welcomeTrailerDir) return;
  for (const rule of Object.values(WELCOME_TRAILER_ASSETS)) {
    fs.rmSync(path.join(config.welcomeTrailerDir, rule.file), { force: true });
  }
}
