# PR #533: Simplify Challenge Rush to a stable 21-game catalog

- Datum des Merges: 2026-09-02
- Branch: `codex/slim-challenge-rush-catalog`
- Merge-Commit: [`efa8622`](https://github.com/blorbeer-cmd/LAN_2026/commit/efa8622a6a07d3d606cfa76c87d2fe691c93f6db)
- Pull Request: [#533](https://github.com/blorbeer-cmd/LAN_2026/pull/533)

## Changelog

- Challenge Rush schrumpft von 31 auf 21 Challenges. Entfernt wurden Farbwort-Chaos, Odd-One-Out,
  Zahlenblende, CPS-Test, Zahlensalat, Sequenz-Echo, Rückwärts-Echo, Pfad-Gedächtnis, „Was fehlt?“
  und Kofferpacken — besonders fehleranfällige oder gegenüber den verbleibenden Aufgaben redundante
  Challenges. Der Schnitt setzt fort, was
  [#529](pr-529-retire-nine-fragile-challenge-rush-challenges-and-push-preview-phases-from-the-server.md)
  mit dem Rückbau von 40 auf 31 begonnen hatte.
- Die Laufzeit ist damit auf drei Interaktionsformen vereinheitlicht: Kreisreaktion,
  Zehn-Sekunden-Stopp und serverseitige Auswahl-/Memory-Matrix-Trials.
- Der unvollständige Challenge-Rush-Bot entfällt vollständig — Lobby-Event, Planer, Tick-Schleife,
  Sonderwertung und der UI-Umschalter für den KI-Gegner. Die historische Bot-ID bleibt in
  `server/src/arcade/botIds.ts` ausschließlich erhalten, damit alte Ergebnisdaten weiterhin korrekt
  klassifiziert und nicht als menschliche Spieler gewertet werden.
- Mit den Challenges verschwinden die zugehörigen Browserzustände, Renderer, Styles, CSS-Tokens und
  Tests; die Bilanz des PRs sind 108 hinzugefügte gegenüber 943 entfernten Zeilen in 14 Dateien.
  `server/DESIGN_SYSTEM.md` und `server/TESTING.md` sind mitgezogen.
- Erhalten bleiben Lobby, Pause, Reconnect, Forfeit, Ergebnisanzeige und die Admin-Testauswahl.
- Sichtbare Änderung: Im Challenge-Rush-Lobbybereich gibt es keinen KI-Gegner-Umschalter mehr; in
  Testauswahl und Spielrotation erscheinen nur noch die 21 beibehaltenen Aufgaben.
- Bewusster Funktionsabbau: Challenge Rush bietet keinen Bot-Modus mehr. Geprüft wurden `build`,
  `lint`, `check:tokens`, `npm test`, die Challenge-Rush-Socket-/Logik-Suite (34/34) und neun
  betroffene Browser-E2E-Suiten einschließlich eines vollständigen Durchlaufs aller 21 Challenges.
