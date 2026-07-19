const NODE_VERSION = 'v22.17.1';

export function buildControllerSetup(config: {
  respawnBaseUrl: string;
  pairingCode: string;
  accessToken: string;
}) {
  return {
    respawnBaseUrl: config.respawnBaseUrl,
    pairingCode: config.pairingCode,
    accessToken: config.accessToken,
    label: 'LAN-Musikgerät',
  };
}

export function buildUnixLauncher(): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'DIR="$(cd "$(dirname "$0")" && pwd)"',
    `VERSION="${NODE_VERSION}"`,
    'RUNTIME="$DIR/.runtime"',
    'NODE="$RUNTIME/bin/node"',
    '',
    'if [ ! -x "$NODE" ]; then',
    '  OS_RAW="$(uname -s)"',
    '  ARCH_RAW="$(uname -m)"',
    '  case "$OS_RAW" in Darwin) OS="darwin" ;; Linux) OS="linux" ;; *) echo "Nicht unterstütztes System: $OS_RAW"; exit 1 ;; esac',
    '  case "$ARCH_RAW" in arm64|aarch64) ARCH="arm64" ;; x86_64|amd64) ARCH="x64" ;; armv7l) ARCH="armv7l" ;; *) echo "Nicht unterstützte Architektur: $ARCH_RAW"; exit 1 ;; esac',
    '  NAME="node-$VERSION-$OS-$ARCH"',
    '  ARCHIVE="$NAME.tar.gz"',
    '  BASE="https://nodejs.org/dist/$VERSION"',
    '  TMP="$DIR/.runtime-download"',
    '  rm -rf "$TMP" "$RUNTIME"',
    '  mkdir -p "$TMP"',
    '  echo "Die private Controller-Laufzeit wird einmalig geladen…"',
    '  curl -fL "$BASE/$ARCHIVE" -o "$TMP/$ARCHIVE"',
    '  EXPECTED="$(curl -fsSL "$BASE/SHASUMS256.txt" | awk -v file="$ARCHIVE" \'$2 == file { print $1 }\')"',
    '  if command -v shasum >/dev/null 2>&1; then ACTUAL="$(shasum -a 256 "$TMP/$ARCHIVE" | awk \'{print $1}\')"; else ACTUAL="$(sha256sum "$TMP/$ARCHIVE" | awk \'{print $1}\')"; fi',
    '  if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then echo "Prüfsumme der Laufzeit stimmt nicht."; exit 1; fi',
    '  tar -xzf "$TMP/$ARCHIVE" -C "$TMP"',
    '  mv "$TMP/$NAME" "$RUNTIME"',
    '  rm -rf "$TMP"',
    'fi',
    '',
    'exec "$NODE" "$DIR/jam-controller.mjs"',
    '',
  ].join('\n');
}

export function buildWindowsLauncher(): string {
  return [
    '@echo off',
    'setlocal',
    'set "DIR=%~dp0"',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%start-windows.ps1"',
    'if errorlevel 1 pause',
    '',
  ].join('\r\n');
}

export function buildWindowsPowerShell(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path',
    `$Version = '${NODE_VERSION}'`,
    "$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }",
    '$Name = "node-$Version-win-$Arch"',
    '$Runtime = Join-Path $Dir ".runtime"',
    '$Node = Join-Path $Runtime "node.exe"',
    'if (-not (Test-Path $Node)) {',
    '  $Base = "https://nodejs.org/dist/$Version"',
    '  $Archive = "$Name.zip"',
    '  $Temp = Join-Path $Dir ".runtime-download"',
    '  Remove-Item $Temp, $Runtime -Recurse -Force -ErrorAction SilentlyContinue',
    '  New-Item $Temp -ItemType Directory | Out-Null',
    '  Write-Host "Die private Controller-Laufzeit wird einmalig geladen..."',
    '  $Zip = Join-Path $Temp $Archive',
    '  Invoke-WebRequest "$Base/$Archive" -OutFile $Zip',
    '  $Sums = (Invoke-WebRequest "$Base/SHASUMS256.txt").Content -split "`n"',
    '  $Line = $Sums | Where-Object { $_ -match "\\s$([regex]::Escape($Archive))$" } | Select-Object -First 1',
    '  $Expected = ($Line -split "\\s+")[0].ToLowerInvariant()',
    '  $Actual = (Get-FileHash $Zip -Algorithm SHA256).Hash.ToLowerInvariant()',
    '  if (-not $Expected -or $Expected -ne $Actual) { throw "Pruefsumme der Laufzeit stimmt nicht." }',
    '  Expand-Archive $Zip -DestinationPath $Temp',
    '  Move-Item (Join-Path $Temp $Name) $Runtime',
    '  Remove-Item $Temp -Recurse -Force',
    '}',
    '& $Node (Join-Path $Dir "jam-controller.mjs")',
    '',
  ].join('\r\n');
}

export function buildControllerReadme(): string {
  return [
    'RESPAWN JAM-CONTROLLER',
    '',
    '1. ZIP vollständig entpacken.',
    '2. macOS: "Start-macOS.command" doppelklicken.',
    '   Windows: "Start-Windows.cmd" doppelklicken.',
    '   Raspberry Pi/Linux: im entpackten Ordner "bash start-linux.sh" ausführen.',
    '3. Beim ersten Start wird automatisch eine private Node.js-Laufzeit in diesen Ordner geladen.',
    '4. Die lokale Einrichtung öffnet sich automatisch. Spotify Client-ID eintragen und anmelden.',
    '',
    'Der Respawn-Server und Kopplungscode sind bereits eingetragen. Das Musikgerät ist kein Spieler.',
    'Repository, npm und eine vorhandene Node.js-Installation sind nicht nötig.',
    '',
  ].join('\n');
}
