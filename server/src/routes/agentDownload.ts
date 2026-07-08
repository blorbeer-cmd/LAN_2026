// "Download the agent" (Profile page): a browser can never install/run a
// native background program on its own — that's a security boundary no web
// app can cross — so this is as automated as it gets: one ZIP, tailored to
// the requesting player (their own API key and this server's URL already
// filled in), containing the prebuilt agent.exe plus a Windows batch script
// that copies everything into place and registers autostart. Behind the
// shared UI access token (mounted under /api, unlike /api/agent/report which
// authenticates via the player's own key instead).

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { db } from '../db';

export const agentDownloadRouter = Router();

const EXE_PATH = path.join(__dirname, '..', '..', 'agent-dist', 'lan2026-agent.exe');

interface PlayerRow {
  id: string;
  name: string;
  api_key: string;
}

function sanitizeForFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '_').slice(0, 40) || 'Spieler';
}

// Exported (pure, no fs/network) so it's directly unit-testable without
// needing a real prebuilt exe on disk. trackActivity is opt-in and chosen by
// the player at download time (a checkbox on the Profile page) rather than
// something they'd have to edit into the config file by hand afterwards —
// anything other than exactly "1" is treated as declined, matching the
// agent's own default-off behavior.
export function buildAgentConfig(serverUrl: string, apiKey: string, trackActivityParam: unknown) {
  return {
    serverUrl,
    apiKey,
    pollIntervalMs: 10000,
    trackActivity: trackActivityParam === '1',
  };
}

// Kept plain-ASCII (no umlauts) since a .bat file's default codepage often
// mangles them; \r\n line endings since Windows batch is picky about that.
//
// Also drops a desktop shortcut to the agent's own local control panel (a
// tiny web page it serves on 127.0.0.1) — that's where a player later
// pauses tracking, turns autostart off, or uninstalls, without ever touching
// the task manager or the startup folder by hand.
function buildInstallBat(): string {
  const lines = [
    '@echo off',
    'setlocal',
    'set "INSTALL_DIR=%LOCALAPPDATA%\\RespawnHQ-Agent"',
    'set "SRC_DIR=%~dp0"',
    '',
    'echo RespawnHQ-Agent wird eingerichtet...',
    'if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"',
    'copy /Y "%SRC_DIR%lan2026-agent.exe" "%INSTALL_DIR%\\lan2026-agent.exe" >nul',
    'copy /Y "%SRC_DIR%agent.config.json" "%INSTALL_DIR%\\agent.config.json" >nul',
    '',
    'set "STARTUP_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut(\'%STARTUP_DIR%\\RespawnHQ-Agent.lnk\'); $s.TargetPath = \'%INSTALL_DIR%\\lan2026-agent.exe\'; $s.WorkingDirectory = \'%INSTALL_DIR%\'; $s.WindowStyle = 7; $s.Save()"',
    '',
    '(',
    '  echo [InternetShortcut]',
    '  echo URL=http://127.0.0.1:47813',
    ') > "%USERPROFILE%\\Desktop\\RespawnHQ-Agent Steuerung.url"',
    '',
    'echo Fertig! Der Agent startet ab jetzt automatisch bei jedem Windows-Login.',
    'echo Auf dem Desktop liegt eine Verknuepfung "RespawnHQ-Agent Steuerung" zum',
    'echo Pausieren, Autostart an/aus stellen oder Deinstallieren.',
    'echo Starte ihn jetzt auch gleich...',
    'start "" "%INSTALL_DIR%\\lan2026-agent.exe"',
    '',
    'timeout /t 5',
  ];
  return lines.join('\r\n') + '\r\n';
}

// Companion to install.bat, for anyone who wants the agent fully off their
// PC rather than just pausing tracking from the web app: stops the running
// process, removes the autostart shortcut, and deletes the install
// directory. Doesn't touch anything server-side — a player can just use the
// "Tracking pausieren" toggle on their profile instead if they might want
// it back later.
function buildUninstallBat(): string {
  const lines = [
    '@echo off',
    'setlocal',
    'set "INSTALL_DIR=%LOCALAPPDATA%\\RespawnHQ-Agent"',
    'set "STARTUP_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"',
    '',
    'echo RespawnHQ-Agent wird entfernt...',
    'taskkill /IM lan2026-agent.exe /F >nul 2>&1',
    'del /Q "%STARTUP_DIR%\\RespawnHQ-Agent.lnk" >nul 2>&1',
    'rmdir /S /Q "%INSTALL_DIR%" >nul 2>&1',
    '',
    'echo Fertig! Der Agent laeuft nicht mehr und startet auch nicht mehr automatisch.',
    'timeout /t 5',
  ];
  return lines.join('\r\n') + '\r\n';
}

// GET /api/agent-download?playerId=...&trackActivity=1 - streams a
// personalized ZIP.
agentDownloadRouter.get('/', (req, res) => {
  const { playerId, trackActivity } = req.query;
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id, name, api_key FROM players WHERE id = ?').get(playerId) as
    | PlayerRow
    | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  if (!fs.existsSync(EXE_PATH)) {
    return res.status(503).json({
      error:
        'Der Agent wurde auf dem Server noch nicht bereitgestellt (agent-dist/lan2026-agent.exe fehlt). Bitte den Organisator informieren.',
    });
  }

  const serverUrl = `${req.protocol}://${req.get('host')}`;
  const config = buildAgentConfig(serverUrl, player.api_key, trackActivity);

  res.attachment(`RespawnHQ-Agent-${sanitizeForFilename(player.name)}.zip`);
  res.set('Content-Type', 'application/zip');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err: Error) => {
    // Streaming already started by the time this can fire (headers are
    // sent as soon as archiving begins) — nothing left to do but end the
    // response and log; a clean JSON error response is no longer possible.
    // eslint-disable-next-line no-console
    console.error('Fehler beim Erstellen des Agent-Downloads:', err);
    res.end();
  });
  archive.pipe(res);
  archive.file(EXE_PATH, { name: 'lan2026-agent.exe' });
  archive.append(JSON.stringify(config, null, 2), { name: 'agent.config.json' });
  archive.append(buildInstallBat(), { name: 'install.bat' });
  archive.append(buildUninstallBat(), { name: 'uninstall.bat' });
  archive.finalize();
});
