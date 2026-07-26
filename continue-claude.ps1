$Project = "C:\Users\BOB\LAN_2026"
$Marker  = Join-Path $Project ".claude-auto-continue"
$LogDir  = Join-Path $Project ".claude\autorun-logs"
$Lock    = Join-Path $Project ".claude-auto-running"

if (-not (Test-Path -LiteralPath $Marker)) {
    exit 0
}

Set-Location -LiteralPath $Project
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Verhindert parallele Claude-Prozesse
try {
    $LockStream = [System.IO.File]::Open(
        $Lock,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
}
catch {
    exit 0
}

try {
    $Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $LogFile = Join-Path $LogDir "$Timestamp.log"
    $Prompt = Get-Content -LiteralPath ".\AUTORUN.md" -Raw

    & claude `
        --continue `
        --print `
        --max-turns 50 `
        --allowedTools "Read" "Edit" "Write" "Glob" "Grep" `
        $Prompt *>&1 |
        Tee-Object -FilePath $LogFile

    exit $LASTEXITCODE
}
finally {
    $LockStream.Dispose()
    Remove-Item -LiteralPath $Lock -Force -ErrorAction SilentlyContinue
}