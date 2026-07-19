# Main: Mobile-Layout-Fixes und Info-Popover-Scroll-Race behoben

- Datum: 2026-07-18
- Commits: [`c8ba2a0`](https://github.com/blorbeer-cmd/Respawn/commit/c8ba2a0), [`816c786`](https://github.com/blorbeer-cmd/Respawn/commit/816c786)
- Integration: direkt auf `main` umgesetzt

## Changelog

- Spieler-Auswahlkarten (Teams-Auslosung/Captain-Draft, Turnier-Erstellung) stapeln auf dem Phone
  wieder eine Spalte statt erzwungener zwei Spalten, die Checkbox, Avatar, Name und Skill-Wert
  über den Kartenrand hinaus quetschten; ab `--bp-md` bleiben es zwei Spalten.
- Eine ungerade letzte Statuskarte im Turnier-Detail spannt auf Phones die volle Zeile statt eine
  Lücke danebenzulassen.
- Anzahl- und Preisfeld der Sammelbestellung behalten ihr Suffix-Padding gegenüber der
  generischen `input[type=...]`-Regel, sodass Werte nicht mehr unter das ×/€-Zeichen laufen.
- Kontextuelle Info-Popover (`infoTooltip.js`) schließen bei Scroll nur noch, wenn der Trigger
  sich tatsächlich bewegt hat. Vorher schloss ein asynchron nachgelieferter Scroll-Event (z. B.
  nach einem bereits abgeschlossenen Auto-Scroll oder auslaufendem Touch-Momentum) den Popover
  sofort nach dem Öffnen wieder; das ließ den Turnier-E2E-Test in CI flaky werden, bis die Ursache
  statt der Testerwartung korrigiert wurde.
