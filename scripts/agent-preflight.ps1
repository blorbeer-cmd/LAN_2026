param(
    [ValidateSet("root", "server", "frontend", "agent", "docs", "infra")]
    [string]$Scope = "root"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

function Write-Section {
    param([string]$Title)

    Write-Output ""
    Write-Output "=== $Title ==="
}

function Get-CommandVersion {
    param(
        [string]$Command,
        [string[]]$Arguments
    )

    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        return "nicht gefunden"
    }

    $output = & $Command @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        return "nicht ausfuehrbar"
    }

    return ($output | Select-Object -First 1).ToString().Trim()
}

Write-Output "Agent-Preflight"
Write-Output "Repository: $RepoRoot"
Write-Output "Bereich:    $Scope"

Write-Section "Git"
$branch = & git -C $RepoRoot branch --show-current | Select-Object -First 1
if ($null -eq $branch -or -not $branch.Trim()) {
    $branch = "detached HEAD"
}
else {
    $branch = $branch.Trim()
}
Write-Output "Branch: $branch"

$status = @(& git -C $RepoRoot status --short)
if ($status.Count -eq 0) {
    Write-Output "Arbeitsbaum: sauber"
}
else {
    Write-Output "Arbeitsbaum: vorhandene Aenderungen bewahren"
    $status | ForEach-Object { Write-Output "  $_" }
}

Write-Section "Laufzeit"
if ($Scope -in @("server", "frontend")) {
    Write-Output "Node: $(Get-CommandVersion -Command "node" -Arguments @("--version"))"
    Write-Output "server/node_modules: $(if (Test-Path -LiteralPath (Join-Path $RepoRoot "server/node_modules")) { "vorhanden" } else { "fehlt" })"
}
elseif ($Scope -eq "agent") {
    Write-Output "Node: $(Get-CommandVersion -Command "node" -Arguments @("--version"))"
    Write-Output "agent/node_modules:  $(if (Test-Path -LiteralPath (Join-Path $RepoRoot "agent/node_modules")) { "vorhanden" } else { "fehlt" })"
    Write-Output "server/node_modules (fuer E2E): $(if (Test-Path -LiteralPath (Join-Path $RepoRoot "server/node_modules")) { "vorhanden" } else { "fehlt" })"
}
else {
    Write-Output "Fuer diesen Bereich ist keine Laufzeitpruefung am Arbeitsstart noetig."
}

Write-Section "Pflichtkontext"
Write-Output "- AGENTS.md"
Write-Output "- DEVELOPMENT_GUIDELINES.md"

switch ($Scope) {
    "server" {
        Write-Output "- server/AGENTS.md"
        Write-Output "- server/DEVELOPMENT_GUIDELINES.md"
        Write-Output "- server/TESTING.md bei Implementierung oder Tests"
    }
    "frontend" {
        Write-Output "- server/AGENTS.md"
        Write-Output "- server/DEVELOPMENT_GUIDELINES.md"
        Write-Output "- server/TESTING.md"
        Write-Output "- server/public/AGENTS.md"
        Write-Output "- server/DESIGN_SYSTEM.md"
    }
    "agent" {
        Write-Output "- agent/AGENTS.md"
        Write-Output "- agent/DEVELOPMENT_GUIDELINES.md"
        Write-Output "- agent/README.md nur bei den dort genannten Funktionsbereichen"
    }
    "docs" {
        Write-Output "- docs/changelog/AGENTS.md nur bei Projekthistorie unter docs/changelog/"
    }
    "infra" {
        Write-Output "- server/OPERATIONS.md bei Deployment-, Logging-, Backup- oder Betriebsaenderungen"
    }
}

Write-Section "Standardpruefungen"
switch ($Scope) {
    "server" {
        Write-Output "npm --prefix server run lint"
        Write-Output "npm --prefix server run build"
        Write-Output "npm --prefix server test"
        Write-Output "E2E nur bei Frontend oder view-uebergreifenden Ablaeufen: npm --prefix server run test:e2e"
        Write-Output "Tooling-/Format-Konfiguration: npm --prefix server run format:check"
    }
    "frontend" {
        Write-Output "npm --prefix server run lint"
        Write-Output "npm --prefix server run build"
        Write-Output "npm --prefix server test"
        Write-Output "npm --prefix server run check:tokens"
        Write-Output "npm --prefix server run test:e2e"
    }
    "agent" {
        Write-Output "npm --prefix agent run lint"
        Write-Output "npm --prefix agent test"
        Write-Output "E2E bei End-to-End- oder Serververtragsaenderungen: npm --prefix agent run test:e2e"
    }
    "docs" {
        Write-Output "Keine pauschale Testsuite; Links, Metadaten und betroffene Dokumentstruktur gezielt pruefen."
    }
    "infra" {
        Write-Output "Keine pauschale Testsuite; betroffene Konfiguration statisch validieren und Betriebsrisiko nennen."
    }
    default {
        Write-Output "Pruefungen aus dem tatsaechlich betroffenen Bereich waehlen."
    }
}

Write-Section "Naechster Schritt"
Write-Output "Auftrag intern aus der Prosa konkretisieren und direkt die relevanten Pfade lesen."
