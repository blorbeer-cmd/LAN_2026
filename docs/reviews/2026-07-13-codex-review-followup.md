# Nachverfolgung der offenen Codex-Review-Kommentare (Stand 2026-07-13)

Aufarbeitung aller unaufgelösten Review-Kommentare des Codex-Connectors auf den
zuletzt gemergten PRs (#147–#172). Jeder Fund wurde gegen den aktuellen Stand
von `main` (`b4943e3`) verifiziert; dieser Branch (`claude/arcade-e2e-testing-gn96bz`)
setzt die noch offenen Punkte um. Die Nummerierung F1–F12 dient dem Nachreview.

## Bereits vor diesem Branch behoben (keine Änderung nötig)

| # | PR | Fund | Beleg im aktuellen Code |
|---|---|---|---|
| F1 | [#158](https://github.com/blorbeer-cmd/Respawn/pull/158#discussion_r3567234517) | Höhen-Cap (`100dvh - 18rem`) verzerrte expandierte Spielfelder | #160/#162 leiten die Breite inzwischen aus dem Höhen-Cap ab (`width: min(100%, calc((100dvh - 18rem) * <ratio>))` in `style.css`), `aspect-ratio` bleibt maßgeblich |
| F2 | [#158](https://github.com/blorbeer-cmd/Respawn/pull/158#discussion_r3567234518) | Tetris-Overlays deckten die leere Spalte statt des Boards ab | `.is-expanded .tetris-canvas-wrap` ist auf `min(100%, calc((100dvh - 18rem) / 2))` begrenzt und die Canvas füllt den Wrap (`width: 100%`), Overlays liegen damit auf dem sichtbaren Board |
| F6 | [#163](https://github.com/blorbeer-cmd/Respawn/pull/163#discussion_r3568089106) | Match-Ende navigierte Nutzer aus fremden Views weg | Alle Redirects in `arcadeWatch.js` sind seit #164 mit `isArcadeWatchView()` geschützt |
| F8/F10 | [#166](https://github.com/blorbeer-cmd/Respawn/pull/166#discussion_r3568791891), [#167](https://github.com/blorbeer-cmd/Respawn/pull/167#discussion_r3568849588) | Scribble-Streams wurden auf dunklem `--bg` statt weißem Papier repliziert | `arcadeStreamRenderer.js` füllt Scribble-Canvases mit `SCRIBBLE_PAPER_COLOR` (`#ffffff`) |
| F11 | [#167](https://github.com/blorbeer-cmd/Respawn/pull/167#discussion_r3568849593) | Gespeicherte Scribble-Bilder wurden 4:3 statt 8:5 angezeigt | `.scribble-stored-canvas-wrap` hat `aspect-ratio: 8 / 5` |

## In diesem Branch umgesetzt

### F3/F5 – Expandierte Scribble-Canvas verlor das 8:5-Verhältnis

- Kommentare: [#160](https://github.com/blorbeer-cmd/Respawn/pull/160#discussion_r3567266502), [#162](https://github.com/blorbeer-cmd/Respawn/pull/162#discussion_r3567304706)
- Befund bestätigt: Die Regel `.arcade-game-shell.is-expanded … canvas { height: auto; }`
  galt auch für `#scribble-canvas`. Die Scribble-Canvas trägt beim ersten Render
  keine `width`/`height`-Attribute; `height: auto` fiel damit auf das intrinsische
  300×150 (2:1) zurück, obwohl der Wrapper 8:5 vorgibt. `setupCanvas()` kopierte
  anschließend die verzerrte Geometrie in die Zeichenfläche.
- Fix (`server/public/css/style.css`): Scribble aus der `height: auto`-Liste
  herausgenommen; eine eigene Regel hält die Canvas auf `width/height: 100%`,
  der Wrapper mit `aspect-ratio: 8 / 5` bleibt die Geometrie-Autorität.
  Blobby/Pong/Snake behalten `height: auto` — deren Canvases haben feste
  Pixel-Attribute, dort ist es korrekt.
- Test: `src/test/e2e/arcade.e2e.test.ts` („Scribble: expanded canvas keeps 8:5 …“)
  startet mit gespeicherter Expand-Präferenz **vor** dem Canvas-Mount (1280×640,
  Höhen-Cap aktiv) und prüft: Canvas füllt den Wrapper, Verhältnis ≈ 1,6,
  kein horizontales Scrollen.

### F4 – Tetris-Glow erzeugte horizontales Scrollen im Expand-Modus

- Kommentar: [#160](https://github.com/blorbeer-cmd/Respawn/pull/160#discussion_r3567266503)
- Befund bestätigt: `.tetris-boards::before` (`inset: -24px`) ragte bei
  nahezu voller Viewport-Breite über `.view-container` hinaus; das frühere
  `overflow: hidden` der Expanded-Regel war beim Umbau in #160 entfallen.
- Fix (`server/public/css/style.css`): `overflow: hidden` in
  `.arcade-game-shell.is-expanded .tetris-boards` wiederhergestellt (mit
  Kommentar zum Warum).
- Test: `arcade.e2e.test.ts` („expanded Tetris …“) prüft im echten
  Zwei-Spieler-Match `scrollWidth <= clientWidth` sowie die Overlay-Ausrichtung
  (Wrap-Breite = Canvas-Breite, F2-Absicherung).

### F7 – Stale Watch-History-Eintrag blieb auf „Verbindung…“ hängen

- Kommentar: [#164](https://github.com/blorbeer-cmd/Respawn/pull/164#discussion_r3568146651)
- Befund bestätigt: Verlässt ein Zuschauer die Watch-View über die globale
  Navigation und endet das Match danach, blieb der `arcadeWatch`-History-Eintrag
  bestehen. Zurück-Taste ⇒ `renderArcadeWatch()` ohne `watchedMatchId` ⇒ tote
  „Verbindung…“-Ansicht ohne weitere Updates.
- Fix:
  - `server/public/js/app.js`: `switchView()` und das `respawn:navigate`-Event
    unterstützen jetzt `{ view, replace: true }` — der Redirect ersetzt den
    aktuellen History-Eintrag per `history.replaceState` statt zu pushen.
    Ein Push hätte eine Back-Falle erzeugt (Back ⇒ stale Eintrag ⇒ Redirect
    pusht erneut ⇒ Endlos-Pendeln). String-Details funktionieren unverändert.
  - `server/public/js/views/arcadeWatch.js`: `renderArcadeWatch()` leitet ohne
    `watchedMatchId` sofort mit `replace` zum Arcade um; die drei bestehenden
    Match-Ende-Redirects (Join-Fehler, Verschwinden aus der Watch-Liste,
    `arcade:watch:ended`) ersetzen den Watch-Eintrag jetzt ebenfalls, statt
    ihn als toten Eintrag im Verlauf zu hinterlassen.
- Tests: `arcade.e2e.test.ts` („watch history: a stale watch entry redirects …“)
  spielt exakt das Kommentar-Szenario nach (Watch → globale Nav → Match-Ende →
  Back) und prüft zusätzlich, dass ein zweites Back **nicht** wieder auf dem
  Watch-Eintrag landet. Der bestehende Back/Forward-Test in `flows.e2e.test.ts`
  deckt die unveränderte Push-Semantik ab.

### F9 – Rejoin während der Galerie parkte alte Strokes für die nächste Runde

- Kommentar: [#167](https://github.com/blorbeer-cmd/Respawn/pull/167#discussion_r3568849582)
- Befund bestätigt: `scribble:rejoin` setzte `replayStrokesOnNextCanvas`
  bedingungslos. Außerhalb der Drawing-Phase ist keine Canvas gemountet, die
  den Wert konsumiert; das nächste `setupCanvas()` (neue Runde, leere Canvas)
  replizierte dann das alte Bild.
- Fix (`server/public/js/views/arcadeScribble.js`): Replay-Strokes werden nur
  noch für `sync.phase === 'drawing'` übernommen, sonst explizit auf `null`
  gesetzt.
- Test: `arcade.e2e.test.ts` (Scribble-Test) trennt den Rater während der
  Galerie kurz vom Netz (`context.setOffline`), lässt ihn rejoinen und prüft,
  dass beide Canvases zu Beginn von Runde 2 pixelweise leer sind.

### F12 – Aufgelöste Rundenbilder blieben in der Folgerunde bewertbar

- Kommentar: [#167](https://github.com/blorbeer-cmd/Respawn/pull/167#discussion_r3568849597)
- Befund bestätigt: `startNextTurn()` ließ `currentDrawingId` stehen. Nach der
  Galerie-Auflösung behandelten `spectatorVoting()` und `scribble:reaction`
  das bereits gekürte Bild weiter als aktuelles Reaktionsziel; die Watch-View
  zeigte in der neuen Runde veraltete Bewertungskarten.
- Fix (`server/src/arcade/scribble.ts`): Beim Verlassen einer **aufgelösten**
  Galerie wird `currentDrawingId` genullt. Turnwechsel mitten in der Runde
  behalten das Verhalten „Letztes Bild bewerten“ bewusst bei (das war der
  gewollte Bewertungszeitraum, siehe Kommentar im Code).
- Test: `arcade.e2e.test.ts` (Scribble-Test) prüft, dass die Watch-View nach
  „Rundenbild gekürt“ und Start der Folgerunde keine Bewertungskarten mehr
  zeigt.

## Zusätzlich in diesem Branch (außerhalb der Codex-Kommentare)

### Schwelle gegen Push-Spam beim Lobby-Erstellen

- Motivation: `arcade:lobby:create` (Quiz) und `scribble:lobby:create` senden
  eine echte Push-Benachrichtigung an **alle** anderen Spieler. Schnelles
  Erstellen/Schließen im Wechsel wurde bislang ungebremst zu einem Push-Sturm.
- Umsetzung: `server/src/arcade/lobbyPush.ts` — pro `gameType` maximal ein
  Lobby-Push je 2 Minuten (`LOBBY_PUSH_COOLDOWN_MS`). Ein unterdrückter
  Versuch verlängert das Fenster nicht. Lobby-Erstellung selbst bleibt
  ungedrosselt (Socket-Broadcasts sind billig, nur die Pushes sind teuer).
- Tests: `lobbyPush.test.ts` (Unit) und
  `api.arcadeLobbyConcurrency.test.ts` („rapid-fire lobby creation …“):
  10 parallele Create-Versuche ⇒ genau eine Lobby; Close/Create-Spam ⇒ genau
  ein `push_log`-Eintrag.

### Neue E2E-Abdeckung (`server/src/test/e2e/arcade.e2e.test.ts`)

1. Watch-Lifecycle: Laufende Spiele erscheinen in der Übersicht, verschwinden
   nach Abschluss, aktive Zuschauer werden automatisch zurück ins Arcade
   geführt.
2. Stale-History-Redirect (F7, siehe oben).
3. Rapid-Fire: 5× Lobby-erstellen-Burst ⇒ genau eine Lobby (Server-Guard);
   Ready-Toggle-Spam ⇒ UI bleibt konsistent und bedienbar.
4. Expandiertes Tetris: kein horizontales Scrollen, Overlay-Geometrie (F2/F4).
5. Scribble über 2 Runden: 8:5-Geometrie unter Höhen-Cap (F3/F5), Toggle-Spam
   auf dem Expand-Button, Galerie-Reconnect (F9), geschlossenes
   Bewertungsfenster nach Rundenauflösung (F12).

### CI/CD-Konsolidierung (`.github/workflows/deploy.yml`)

- Vorher: ein serieller `test`-Job (Token-Check → Lint → Format → Build →
  Unit/Integration → Agent-Install/-Tests/-E2E → Playwright-Install →
  Browser-E2E), danach erst Image-Build, danach Deploy — jede Stufe wartete
  auf die komplette vorherige.
- Jetzt: vier parallele Jobs (`server-checks`, `e2e`, `agent`, `image`);
  `publish` (nur main-Push oder manuell mit `deploy=true`) veröffentlicht das
  Image aus dem geteilten Buildx-Layer-Cache, `deploy` bleibt unverändert
  inklusive Rollback-Logik und `production-deploy`-Concurrency.
- Weitere Beschleuniger: Playwright-Browser-Cache (Download nur bei
  Versionswechsel), `concurrency` bricht überholte Läufe auf Nicht-main-Refs
  ab, `fetch-depth: 0` nur noch dort, wo der Token-Check die Historie braucht.
- Unverändert: Umfang der Pflichtchecks, PR-Gate über den Runtime-Image-Build
  (aus #169), Verhalten von `workflow_dispatch` (nur Checks ohne
  `deploy=true`), Deploy-Härtung aus #169/#171.
- ⚠️ Hinweis für den Betrieb: Falls Branch-Protection den alten Statusnamen
  „Build and test“ als Pflichtcheck referenziert, muss er auf die neuen
  Job-Namen umgestellt werden (`Server lint, build and tests`, `Browser E2E`,
  `Agent lint and tests`, `Build runtime image`).

## Ausgeführte Prüfungen

Aus `server/` (Node 22.22.2, siehe Einschränkung): `npm run lint`,
`npm run format:check`, `npm run check:tokens -- --base-ref origin/main`,
`npm run build`, `npm test`, `npm run test:e2e`.

Einschränkung: In der Prüfumgebung stand nur Node 22 zur Verfügung, nicht das
per `.nvmrc`/`engines` gepinnte Node 24. Alle Suiten liefen grün; die CI
validiert denselben Stand zusätzlich unter Node 24.
