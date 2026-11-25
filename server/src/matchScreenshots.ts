// Screenshots attached to a recorded Match result (a draw from the Match
// history), e.g. the final scoreboard as proof. The images are files in
// config.matchScreenshotDir named "match-shot-<row id>.<ext>"; the prefix keeps
// them apart from any other file an operator keeps in the same folder.
// match_screenshots only records which match a file belongs to. Rows follow
// their match through every delete path (ON DELETE CASCADE), and
// pruneMatchScreenshotFiles() removes the prefixed files no row names any more.

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform, type Readable } from 'stream';
import { nanoid } from 'nanoid';
import { config } from './config';
import { db } from './db';

export const MATCH_SCREENSHOT_LIMIT = 4;
export const MATCH_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
// An oversized body is still read up to this size and then answered with 413,
// so the client gets the message instead of a reset connection. Beyond it the
// connection is dropped rather than draining arbitrary amounts of data.
export const MATCH_SCREENSHOT_DRAIN_BYTES = 4 * MATCH_SCREENSHOT_MAX_BYTES;
const FILE_PREFIX = 'match-shot-';
const STALE_UPLOAD_MS = 60 * 60 * 1000;

// A cheap content check against renamed files, as for the welcome trailer.
const IMAGE_TYPES: Record<string, { ext: string; matches: (head: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', matches: (head) => head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff },
  'image/png': {
    ext: 'png',
    matches: (head) => head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  'image/webp': {
    ext: 'webp',
    matches: (head) => head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP',
  },
};

const FILE_NAME = /^match-shot-[A-Za-z0-9_-]{1,64}\.(jpg|png|webp)$/;
const TEMP_NAME = /^\.match-shot-[A-Za-z0-9_-]{1,64}\.upload$/;

export interface MatchScreenshot {
  id: string;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedAt: number;
}

interface ScreenshotRow {
  id: string;
  match_id: string;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  content_type: string;
  created_at: number;
}

export class MatchScreenshotError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function isMatchScreenshotType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(IMAGE_TYPES, type);
}

function fileName(id: string, contentType: string): string {
  return `${FILE_PREFIX}${id}.${IMAGE_TYPES[contentType].ext}`;
}

// File removal runs after the database already committed. A locked or
// vanished file must not turn that success into an error; the hourly prune
// retries every file no row names any more.
function removeFile(file: string): boolean {
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch (error) {
    console.error('[match-screenshots] could not remove', file, error);
    return false;
  }
}

export function matchScreenshotTooLarge(): MatchScreenshotError {
  return new MatchScreenshotError(413, `Das Bild ist zu groß (höchstens ${MATCH_SCREENSHOT_MAX_BYTES / 1024 / 1024} MB).`);
}

// Only results of the Match history (a recorded draw) take screenshots. Admin
// free entries have no place that shows them, and a corrected tournament
// fixture deletes and recreates its match row, which would drop them.
export function acceptsMatchScreenshots(matchId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM matchmaking_draws WHERE match_id = ?').get(matchId));
}

export const SCREENSHOT_MATCH_ONLY = 'Screenshots lassen sich nur an Ergebnisse aus der Match-Historie hängen.';

const SELECT_COLUMNS = `s.id, s.match_id, s.uploaded_by, p.name AS uploaded_by_name, s.content_type, s.created_at
  FROM match_screenshots s LEFT JOIN players p ON p.id = s.uploaded_by`;

function toScreenshot(row: ScreenshotRow): MatchScreenshot {
  return { id: row.id, uploadedBy: row.uploaded_by, uploadedByName: row.uploaded_by_name, uploadedAt: row.created_at };
}

export function listMatchScreenshots(matchIds: string[]): Map<string, MatchScreenshot[]> {
  const byMatch = new Map<string, MatchScreenshot[]>();
  if (matchIds.length === 0) return byMatch;
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} WHERE s.match_id IN (SELECT value FROM json_each(?)) ORDER BY s.created_at, s.id`,
    )
    .all(JSON.stringify(matchIds)) as ScreenshotRow[];
  for (const row of rows) {
    const list = byMatch.get(row.match_id) ?? [];
    list.push(toScreenshot(row));
    byMatch.set(row.match_id, list);
  }
  return byMatch;
}

export function findMatchScreenshot(matchId: string, screenshotId: string): (MatchScreenshot & { file: string; contentType: string }) | null {
  if (!config.matchScreenshotDir) return null;
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} WHERE s.id = ? AND s.match_id = ?`)
    .get(screenshotId, matchId) as ScreenshotRow | undefined;
  if (!row) return null;
  return {
    ...toScreenshot(row),
    contentType: row.content_type,
    file: path.join(config.matchScreenshotDir, fileName(row.id, row.content_type)),
  };
}

// Streams the upload into a private temporary file first. Only a complete,
// size- and format-checked file gets a row, and the limit check, the insert
// and the rename run synchronously in one transaction: of several parallel
// uploads exactly as many as fit win, the others get 409 and leave nothing.
export async function storeMatchScreenshot(
  matchId: string,
  uploadedBy: string,
  contentType: string,
  body: Readable,
  declaredLength: number | null,
): Promise<MatchScreenshot> {
  const dir = config.matchScreenshotDir;
  if (!dir) throw new MatchScreenshotError(409, 'Auf diesem Server ist kein Speicherort für Screenshots eingerichtet.');
  const rule = IMAGE_TYPES[contentType];
  if (!rule) throw new MatchScreenshotError(415, 'Bitte ein Bild im Format JPEG, PNG oder WebP hochladen.');
  if (declaredLength !== null && declaredLength > MATCH_SCREENSHOT_DRAIN_BYTES) throw matchScreenshotTooLarge();

  fs.mkdirSync(dir, { recursive: true });
  const id = nanoid();
  const temp = path.join(dir, `.${FILE_PREFIX}${id}.upload`);
  let received = 0;
  let oversized = false;
  let head = Buffer.alloc(0);
  // Past the limit the body is still consumed but no longer written, so the
  // request ends normally and the 413 below reaches the client.
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > MATCH_SCREENSHOT_DRAIN_BYTES) {
        callback(matchScreenshotTooLarge());
        return;
      }
      if (received > MATCH_SCREENSHOT_MAX_BYTES) oversized = true;
      if (oversized) {
        callback();
        return;
      }
      if (head.length < 12) head = Buffer.concat([head, chunk.subarray(0, 12 - head.length)]);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(body, limit, fs.createWriteStream(temp, { flags: 'wx' }));
    if (oversized) throw matchScreenshotTooLarge();
    if (received === 0) throw new MatchScreenshotError(400, 'Das Bild ist leer.');
    if (!rule.matches(head)) throw new MatchScreenshotError(400, 'Die Datei ist kein gültiges Bild im angegebenen Format.');
    const createdAt = Date.now();
    db.transaction(() => {
      if (!db.prepare('SELECT 1 FROM matches WHERE id = ?').get(matchId)) {
        throw new MatchScreenshotError(404, 'Match nicht gefunden.');
      }
      if (!acceptsMatchScreenshots(matchId)) throw new MatchScreenshotError(409, SCREENSHOT_MATCH_ONLY);
      const { count } = db.prepare('SELECT COUNT(*) AS count FROM match_screenshots WHERE match_id = ?').get(matchId) as { count: number };
      if (count >= MATCH_SCREENSHOT_LIMIT) {
        throw new MatchScreenshotError(409, `Pro Match sind höchstens ${MATCH_SCREENSHOT_LIMIT} Screenshots möglich.`);
      }
      db.prepare('INSERT INTO match_screenshots (id, match_id, uploaded_by, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, matchId, uploadedBy, contentType, received, createdAt);
      // Inside the transaction: if the rename fails, the row is rolled back.
      fs.renameSync(temp, path.join(dir, fileName(id, contentType)));
    })();
    const uploader = db.prepare('SELECT name FROM players WHERE id = ?').get(uploadedBy) as { name: string } | undefined;
    return { id, uploadedBy, uploadedByName: uploader?.name ?? null, uploadedAt: createdAt };
  } catch (error) {
    removeFile(temp);
    if (error instanceof MatchScreenshotError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET' || code === 'ECONNABORTED') {
      throw new MatchScreenshotError(400, 'Der Upload wurde abgebrochen.');
    }
    throw new MatchScreenshotError(500, 'Das Bild konnte nicht gespeichert werden.');
  }
}

export function deleteMatchScreenshot(matchId: string, screenshotId: string): boolean {
  const row = db
    .prepare('DELETE FROM match_screenshots WHERE id = ? AND match_id = ? RETURNING id, content_type')
    .get(screenshotId, matchId) as { id: string; content_type: string } | undefined;
  if (!row) return false;
  if (config.matchScreenshotDir) removeFile(path.join(config.matchScreenshotDir, fileName(row.id, row.content_type)));
  return true;
}

// Removes every screenshot file without a row: files of deleted matches,
// events or games, and temporary files an interrupted process left behind.
// Only names with the screenshot prefix are touched, so a folder shared with
// other media keeps its files. Fully synchronous, so it can never interleave
// with an upload's insert-and-rename step; a temporary file of a running
// upload is only removed once it is clearly stale. Never throws: callers run
// it after a committed delete, and the next run retries what failed.
export function pruneMatchScreenshotFiles(now = Date.now()): number {
  const dir = config.matchScreenshotDir;
  if (!dir) return 0;
  try {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    const known = new Set(
      (db.prepare('SELECT id, content_type FROM match_screenshots').all() as Array<{ id: string; content_type: string }>)
        .map((row) => fileName(row.id, row.content_type)),
    );
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const file = path.join(dir, entry.name);
      if (TEMP_NAME.test(entry.name)) {
        try {
          if (now - fs.statSync(file).mtimeMs < STALE_UPLOAD_MS) continue;
        } catch {
          continue;
        }
      } else if (!FILE_NAME.test(entry.name) || known.has(entry.name)) {
        continue;
      }
      if (removeFile(file)) removed += 1;
    }
    return removed;
  } catch (error) {
    console.error('[match-screenshots] prune failed:', error);
    return 0;
  }
}

let pruneTimer: NodeJS.Timeout | null = null;

export function startMatchScreenshotPrune(): void {
  if (pruneTimer || !config.matchScreenshotDir) return;
  const prune = () => {
    pruneMatchScreenshotFiles();
  };
  prune();
  pruneTimer = setInterval(prune, 60 * 60 * 1000);
  pruneTimer.unref();
}
