# Branch: `claude/search-palette-keyboard-flake`

## Themenstrang

Ursächliche Stabilisierung des langjährigen Global-Search-Keyboard-Flakes im Browser-E2E:
`searchPalette.js` reagiert auf `pointermove` statt `pointerover` (ein von Chromium bei
Re-Render/Scroll unter stehendem Cursor synthetisch erneut ausgelöstes `pointerover` schnappte die
Tastatur-Auswahl still auf die Hover-Zeile zurück) und stellt die Tastatur-Auswahl nach dem
Late-Merge-Re-Render der Content-Einträge wieder her. Wiederherstellung der in PR #238 bewusst als
fachfremd entfernten, dort bereits per In-Page-Event-Recorder verifizierten Korrektur
(ursprünglich Commits `438b625`/`77d27b9`).

## Pull Requests

- Noch kein PR erstellt bzw. gemergt; Eintrag wird beim Öffnen/Merge nachgeführt.
