# PR #174: Arcade: fix open Codex review findings, add spectator/rapid-fire E2E coverage, parallelize CI

- Datum des Merges: 2026-07-13
- Branch: `claude/arcade-e2e-testing-gn96bz`
- Merge-Commit: [`0d10088`](https://github.com/blorbeer-cmd/Respawn/commit/0d1008808dc9801f3d1bbb097c5ae161f8619679)
- Pull Request: [#174](https://github.com/blorbeer-cmd/Respawn/pull/174)

## Changelog

- Offene Codex-Review-Befunde aus den PRs #147–#172 aufgearbeitet; Entscheidungen und
  Verifikation dokumentiert in `docs/reviews/2026-07-13-codex-review-followup.md` (F1–F12).
- Expandierte Scribble-Canvas füllt wieder den 8:5-Wrapper statt auf das intrinsische
  2:1 zurückzufallen; expandierte Tetris-Boards clippen den dekorativen Glow und erzeugen
  kein horizontales Scrollen mehr.
- Stale Watch-History-Einträge (Match endete nach Verlassen der Zuschauer-Ansicht) leiten
  per `history.replaceState` zum Arcade um; `respawn:navigate` unterstützt dafür
  `{ view, replace }` ohne Back-Falle.
- Scribble: Rejoin-Syncs außerhalb der Drawing-Phase parken keine alten Strokes mehr für
  die nächste Runde; nach einer aufgelösten Rundengalerie ist das gekürte Bild nicht mehr
  bewertbar (`currentDrawingId` wird genullt).
- Lobby-Erstellungs-Pushes (Quiz, Scribble) auf einen Push pro Spieltyp je zwei Minuten
  gedrosselt, damit Create/Close-Spam keine Push-Stürme auslöst; Unit- und
  Parallel-Request-Tests ergänzt.
- Neue Browser-E2E-Suite `arcade.e2e.test.ts`: Watch-Listen-Lifecycle, Stale-History-
  Redirect, Lobby-Create-Bursts und Ready-Toggle-Spam, expandierte Tetris-Geometrie sowie
  ein Zwei-Runden-Scribble-Match mit Galerie-Reconnect und Expand-Geometrie-Checks.
- CI/CD in parallele Jobs aufgeteilt (Server-Checks, Browser-E2E, Agent, Runtime-Image);
  Veröffentlichung erfolgt nach grünen Checks aus dem geteilten Buildx-Layer-Cache,
  Playwright-Browser werden gecacht, überholte Läufe auf Nicht-`main`-Refs abgebrochen.
- E2E-Portkonvention (ein eigener Test-Port pro Datei) in `server/TESTING.md` festgehalten;
  Pipeline-Beschreibung in `server/OPERATIONS.md` aktualisiert.
