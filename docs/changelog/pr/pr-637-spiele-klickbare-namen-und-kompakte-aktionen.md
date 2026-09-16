# PR #637: Spiele: klickbare Namen und kompakte Aktionen

- Datum des Merges: 2026-09-16
- Branch: `codex/game-card-clickable-details`
- Merge-Commit: [`67a6405`](https://github.com/blorbeer-cmd/LAN_2026/commit/67a6405)
- Pull Request: [#637](https://github.com/blorbeer-cmd/LAN_2026/pull/637)

## Changelog

- Der Spielname im Katalog öffnet die Details. Die bisherige eigene Info-Aktion in der Zeile ist
  entfallen; der Name ist ein `.btn.btn-sm.game-row-detail-trigger` ohne gefüllte Buttonfläche, der
  auf Hover nur den Text auf `--accent` umstellt.
- Plattform-Link, Trailer-Link und die nicht interaktive Trackbar-Markierung stehen als dichte
  Gruppe direkt am Spielnamen, jeweils in einem festen 32-×-32-px-Slot statt in der 44-px-Breite
  allgemeiner Iconcontrols. Reihenfolge: Plattform, Trailer, Trackbar.
- Die Registry kennt dafür zwei neue Einträge, `game-catalog-link-action` und
  `game-catalog-detail-trigger`; `.game-icon-btn` ist aus `row-icons` herausgelöst. Der
  Controls-Vertrag beschreibt beide Fälle mit Geometrie, Reihenfolge, Zuständen und
  Abnahmebeispielen als dokumentierte dichte Ausnahme.
- Die E2E-Zusicherungen in `flowsShell.fixture.ts` messen die neue Geometrie: Linkaktionen und
  Trackbar-Slot exakt 32 × 32 px, Detailauslöser 31–33 px hoch, kein Zwischenraum zwischen den
  Linkaktionen, kein Seitenoverflow.

## Historischer Kontext

Aus der Katalogzeile, in der Details, Plattform und Trailer als gleichwertige 44-px-Iconaktionen
nebeneinander standen und die Trackbar-Markierung dazwischen in einer eigenen Lücke hing. Der PR
verschiebt die Detailaktion auf den Spielnamen und macht aus den verbleibenden Links eine bewusst
dichte, vertraglich beschriebene Gruppe.
