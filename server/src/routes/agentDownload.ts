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

// Kept plain-ASCII (no umlauts) since a .bat file's default codepage often
// mangles them; \r\n line endings since Windows batch is picky about that.
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
    'echo Fertig! Der Agent startet ab jetzt automatisch bei jedem Windows-Login.',
    'echo Starte ihn jetzt auch gleich...',
    'start "" "%INSTALL_DIR%\\lan2026-agent.exe"',
    '',
    'timeout /t 5',
  ];
  return lines.join('\r\n') + '\r\n';
}

// GET /api/agent-download?playerId=... - streams a personalized ZIP.
agentDownloadRouter.get('/', (req, res) => {
  const { playerId } = req.query;
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
  const config = {
    serverUrl,
    apiKey: player.api_key,
    pollIntervalMs: 10000,
    trackActivity: false,
  };

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
  archive.finalize();
});
