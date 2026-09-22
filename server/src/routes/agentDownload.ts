// "Download the agent" (Profile page): a browser can never install/run a
// native background program on its own — that's a security boundary no web
// app can cross — so this is as automated as it gets: one ZIP, tailored to
// the requesting player (their own API key and this server's URL already
// filled in), containing the prebuilt agent.exe plus a Windows batch script
// that copies everything into place and registers autostart. The download is
// bound to the personal browser session; /api/agent/report authenticates
// independently with the player's agent key.

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { db } from '../db';
import { config } from '../config';
import { withQueryPlayerIdentity } from '../sessions';

export const agentDownloadRouter = Router();

// Directory holding the prebuilt agent executable this download packs into
// its ZIP. Resolved per request rather than once at module load: a deployment
// can relocate the ~90 MB binary to a mounted volume, and the integration test
// can install a small stub instead of compressing the real executable just to
// assert that the response is a real archive.
export function agentExePath(): string {
  const configured = process.env.AGENT_DIST_DIR;
  return configured
    ? path.resolve(configured, 'respawn-agent.exe')
    : path.join(__dirname, '..', '..', 'agent-dist', 'respawn-agent.exe');
}

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

export function resolveAgentServerUrl(protocol: string, host: string, publicBaseUrl = config.publicBaseUrl): string {
  const normalizedPublicBaseUrl = publicBaseUrl.trim().replace(/\/+$/, '');
  return normalizedPublicBaseUrl || `${protocol}://${host}`;
}

export function buildDesktopShortcutCleanupPowerShell(
  desktopExpression = "[Environment]::GetFolderPath('Desktop')",
): string {
  return `$desktop = ${desktopExpression}; @('Respawn-Agent Steuerung.lnk', 'Respawn-Agent Steuerung.url') | ForEach-Object { Remove-Item -LiteralPath (Join-Path $desktop $_) -Force -ErrorAction SilentlyContinue }`;
}

// Kept plain-ASCII (no umlauts) since a .bat file's default codepage often
// mangles them; \r\n line endings since Windows batch is picky about that.
//
// Also drops a desktop launcher shortcut for the agent's own local control
// panel. The launcher asks the running agent for a one-time browser ticket,
// so neither a fixed fallback port nor a long-lived secret has to live in a
// URL shortcut.
export function buildInstallBat(): string {
  const lines = [
    '@echo off',
    'setlocal',
    'set "INSTALL_DIR=%LOCALAPPDATA%\\Respawn-Agent"',
    'set "SRC_DIR=%~dp0"',
    '',
    'echo Respawn-Agent wird eingerichtet...',
    'if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"',
    'if not exist "%INSTALL_DIR%" goto install_failed',
    'copy /Y "%SRC_DIR%respawn-agent.exe" "%INSTALL_DIR%\\respawn-agent.exe.new" >nul',
    'if errorlevel 1 goto install_failed',
    'copy /Y "%SRC_DIR%agent.config.json" "%INSTALL_DIR%\\agent.config.json.new" >nul',
    'if errorlevel 1 goto install_failed',
    '',
    'rem Eine laufende Windows-EXE kann nicht ersetzt werden. Erst nachdem',
    'rem beide neuen Dateien sicher bereitliegen, alten Agent und Tray beenden.',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \'Name = \'\'powershell.exe\'\'\' | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like \'*\\respawn-agent-tray-*.ps1*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
    'set "RESPAWN_AGENT_PATH=%INSTALL_DIR%\\respawn-agent.exe"',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$agentPath = [IO.Path]::GetFullPath($env:RESPAWN_AGENT_PATH); function Get-InstalledAgent { @(Get-CimInstance Win32_Process -Filter \'Name = \'\'respawn-agent.exe\'\'\' | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $agentPath }) }; Get-InstalledAgent | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; for ($i = 0; $i -lt 20 -and @(Get-InstalledAgent).Count -gt 0; $i++) { Start-Sleep -Milliseconds 250 }; if (@(Get-InstalledAgent).Count -gt 0) { exit 1 }"',
    'if errorlevel 1 goto install_failed',
    'move /Y "%INSTALL_DIR%\\respawn-agent.exe.new" "%INSTALL_DIR%\\respawn-agent.exe" >nul',
    'if errorlevel 1 goto install_failed',
    'move /Y "%INSTALL_DIR%\\agent.config.json.new" "%INSTALL_DIR%\\agent.config.json" >nul',
    'if errorlevel 1 goto install_failed',
    '',
    'set "STARTUP_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $env:STARTUP_DIR \'Respawn-Agent.lnk\')); $s.TargetPath = Join-Path $env:INSTALL_DIR \'respawn-agent.exe\'; $s.WorkingDirectory = $env:INSTALL_DIR; $s.WindowStyle = 7; $s.Save()"',
    'if errorlevel 1 goto install_failed',
    '',
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$desktop = [Environment]::GetFolderPath('Desktop'); Remove-Item -LiteralPath (Join-Path $desktop 'Respawn-Agent Steuerung.url') -Force -ErrorAction SilentlyContinue; $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Respawn-Agent Steuerung.lnk')); $s.TargetPath = Join-Path $env:INSTALL_DIR 'respawn-agent.exe'; $s.Arguments = '--open-control'; $s.WorkingDirectory = $env:INSTALL_DIR; $s.WindowStyle = 7; $s.Save()\"",
    'if errorlevel 1 goto install_failed',
    '',
    'echo Starte den Agent...',
    // /D pins the agent's working directory to the install directory. Without
    // it the agent inherits this script's directory (the unpacked download
    // folder) and would put its config-relative files — state, log, the local
    // control panel's runtime file — next to the ZIP instead of the install.
    'start "" /D "%INSTALL_DIR%" "%INSTALL_DIR%\\respawn-agent.exe"',
    // Its own label, not install_failed: by this line both moves are through,
    // so the installation is complete and there is nothing left to roll back.
    // Claiming a failed update here would be wrong, and would send the player
    // into a second install of something that is already installed.
    'if errorlevel 1 goto start_failed',
    '',
    'echo Fertig! Der Agent startet ab jetzt automatisch bei jedem Windows-Login.',
    'echo Auf dem Desktop liegt eine Verknuepfung "Respawn-Agent Steuerung" zum',
    'echo Pausieren, Autostart an/aus stellen oder Deinstallieren.',
    '',
    'timeout /t 5',
    'exit /b 0',
    '',
    ':install_failed',
    'del /Q "%INSTALL_DIR%\\respawn-agent.exe.new" >nul 2>&1',
    'del /Q "%INSTALL_DIR%\\agent.config.json.new" >nul 2>&1',
    'echo Fehler: Der Respawn-Agent konnte nicht sicher aktualisiert werden.',
    'echo Es wurde kein unsicherer Mischstand gestartet.',
    'timeout /t 10',
    'exit /b 1',
    '',
    ':start_failed',
    'echo Der Respawn-Agent wurde vollstaendig installiert, liess sich aber nicht starten.',
    'echo Das kann ein Virenscanner sein, der die neue Datei noch prueft.',
    'echo Er startet spaetestens beim naechsten Windows-Login automatisch.',
    'timeout /t 10',
    'exit /b 1',
  ];
  return lines.join('\r\n') + '\r\n';
}

// Companion to install.bat, for anyone who wants the agent fully off their
// PC rather than just pausing tracking from the web app: stops the running
// process, removes the autostart shortcut, and deletes the install
// directory. Doesn't touch anything server-side — a player can just use the
// "Tracking pausieren" toggle on their profile instead if they might want
// it back later.
export function buildUninstallBat(): string {
  const lines = [
    '@echo off',
    'setlocal',
    'set "INSTALL_DIR=%LOCALAPPDATA%\\Respawn-Agent"',
    'set "STARTUP_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"',
    '',
    'echo Respawn-Agent wird entfernt...',
    'taskkill /IM respawn-agent.exe /F >nul 2>&1',
    'del /Q "%STARTUP_DIR%\\Respawn-Agent.lnk" >nul 2>&1',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${buildDesktopShortcutCleanupPowerShell()}"`,
    'rmdir /S /Q "%INSTALL_DIR%" >nul 2>&1',
    '',
    'echo Fertig! Der Agent laeuft nicht mehr und startet auch nicht mehr automatisch.',
    'timeout /t 5',
  ];
  return lines.join('\r\n') + '\r\n';
}

// GET /api/agent-download?playerId=...&trackActivity=1 - streams a
// personalized ZIP.
agentDownloadRouter.get('/', ...withQueryPlayerIdentity, (req, res) => {
  const { playerId, trackActivity } = req.query;
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id, name, api_key FROM players WHERE id = ? AND deactivated_at IS NULL').get(playerId) as
    | PlayerRow
    | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const exePath = agentExePath();
  if (!fs.existsSync(exePath)) {
    return res.status(503).json({
      error:
        'Der Agent wurde auf dem Server noch nicht bereitgestellt (agent-dist/respawn-agent.exe fehlt). Bitte den Organisator informieren.',
    });
  }

  const serverUrl = resolveAgentServerUrl(req.protocol, req.get('host') ?? '');
  const config = buildAgentConfig(serverUrl, player.api_key, trackActivity);

  res.attachment(`Respawn-Agent-${sanitizeForFilename(player.name)}.zip`);
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
  archive.file(exePath, { name: 'respawn-agent.exe' });
  archive.append(JSON.stringify(config, null, 2), { name: 'agent.config.json' });
  archive.append(buildInstallBat(), { name: 'install.bat' });
  archive.append(buildUninstallBat(), { name: 'uninstall.bat' });
  archive.finalize();
});
