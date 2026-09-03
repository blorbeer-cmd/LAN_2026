# PR #532: Audit the test suite and fix its findings

- Datum des Merges: 2026-09-02
- Branch: `claude/test-suite-audit-9rqxl7`
- Merge-Commit: [`8649eb8`](https://github.com/blorbeer-cmd/LAN_2026/commit/8649eb86e66e74738130339f360fe998207deb3d)
- Pull Request: [#532](https://github.com/blorbeer-cmd/LAN_2026/pull/532)

## Changelog

- Der PR hat zwei Teile: den Bericht `docs/reviews/2026-09-01-test-suite-audit.md` — der Testbestand
  gemessen an den mit
  [#530](pr-530-make-test-design-rules-binding-and-stop-schematic-test-growth.md) verbindlich
  gewordenen Test-Design-Regeln, mit 3 P1-, 7 P2- und 5 P3-Findings sowie fünf Regelwerk-Lücken je
  mit Datei- und Zeilenbezug — und die Umsetzung dieser Findings. Abschnitt 0 des Berichts hält je
  Finding fest, was daraus wurde.
- **Beide P1-Findings hatten eine gemeinsame Produktionsursache.** `main()` macht die Shell
  interaktiv, bevor der erste `loadAll()` committet; landet der Snapshot, baut
  `renderDesktopNavigation()` die Leiste per `innerHTML` neu auf und ersetzt den Button, auf dem
  ein Finger bereits liegt. Ein Klick braucht ein gemeinsames Ziel für `pointerdown` und
  `pointerup` und fällt damit aus — bei echten Nutzenden wie in den Tests.
  `server/public/js/app.js` gleicht die Leiste jetzt in place ab: Überlebende Buttons behalten ihre
  Identität, `append()` verschiebt sie nur, und ein delegierter Listener auf der stabilen Wurzel
  ersetzt die pro Button neu angehängten.
- `#app[data-player-data]` veröffentlicht `loading` / `ready` / `failed`. `waitForPlayerData()`
  ersetzt sechs feste Pausen in `authGate.e2e.test.ts` und die im Login-Helfer von
  `eventInvitations`; die drei Retry-Schleifen in `arcade.fixture.ts` und `challengeRush.fixture.ts`
  entfallen ersatzlos — ihre Kommentare benannten genau diese Race.
- Aus dem Cross-Review nachgeschärft: Das Publizieren eines committeten Snapshots läuft zentral über
  `loadAllAndPublish()`, das alle fünf zentralen Ladepfade nutzen. Nötig war das, weil
  `event-context:changed` den Zustand direkt lädt, außerhalb beider Koordinatoren — eine je
  Aufrufstelle gepflegte Bereitschaftsmeldung konnte dort einen Startaufhänger erzeugen. Die
  Startbarriere, auf die Deep-Link und Erstlogin-Tour warten, löst zusätzlich bei fehlgeschlagenem
  Load und bei `onFailure` des Refresh-Koordinators aus: Bei Netzstörung degradiert der Start, statt
  zu hängen.
- **Der größte Laufzeitposten war Konfiguration.** `src/arcade/timing.ts` verkürzt das
  3-Sekunden-Intro nur bei `NODE_ENV=test` *und* `E2E_FAST_TIMERS`, gesetzt allein von den
  Browser-Skripten. Jeder Socket-Integrationstest wartete deshalb den produktiven Countdown ab, für
  Assertions über Lobby-Gates, Teamzuordnung und Wertung, die den Countdown nie prüfen.
  `ARCADE_FAST_TIMERS` ist jetzt ein zweiter Name desselben Schalters, `END_REVEAL_MS` von Schiffe
  versenken läuft darüber, und `npm test` setzt ihn. Der gemessene `node --test`-Schritt fällt von
  79,9 s auf 54,9 s; `api.battleship` von 19,5 s auf 1,2 s, `api.scribbleThumbsAndFavorites` von
  16,2 s auf 4,5 s, die fünf Arena-/Lobby-Suiten zusammen von 32,0 s auf 5,5 s.
- `api.agentDownload.test.ts` komprimierte eine committete 92-MB-Exe zweimal, um einen Statuscode
  und vier Byte ZIP-Magic zu prüfen — und schaltete seine Erfolgspfad-Assertions per `if
  (exeExists)` ab, wenn die Datei fehlte. Der Pfad wird nun lazy über `AGENT_DIST_DIR` aufgelöst,
  der Test packt einen Stub und prüft beide Zweige unbedingt: 14,9 s auf 0,7 s.
- Weitere Teständerungen: `eventWorkspaceSwitch` wartet auf `#view-container[data-view=…]` statt an
  zehn Aufrufstellen je eine Sekunde zu schlafen; registrierte Browser-Kontexte erhalten
  `E2E_DEFAULT_TIMEOUT_MS` (15 s) statt Playwrights impliziter 30 s, die echte Fehler nur
  verzögerten; der Blobby-Doppel-Browsertest entfällt, weil er dieselben gemeinsamen Module wie der
  Pong-Test fuhr (Blobbys eigener Serververtrag bleibt in `api.blobbyMultiplayer.test.ts`); zwei
  exakte `getBoundingClientRect`-Vergleiche bekommen 1 px Toleranz; `waitForAction` ersetzt 280×25
  ms Handpolling durch ein `Promise.race` zweier `waitFor`; `formatSince` bekommt eine literale
  Erwartung statt eines Nachbaus der Implementierung.
- `phase5eIsolation` ordnet seine Negativzusicherung jetzt über einen quittierten, abgelehnten
  `scope:subscribe`-Rundlauf auf genau der Verbindung, die nichts empfangen darf. Eine Quittung auf
  dem anderen Socket war keine Barriere: zwei unabhängige Transporte sagen nichts übereinander aus.
- `switchSessionCookie()` schließt das Fenster, in dem ein E2E-Identitätswechsel die Session an die
  gleitende Cookie-Auffrischung des Servers verlieren konnte. `requireUser` erneuert das Cookie bei
  jedem Request; Antworten der alten Identität schrieben es zurück, und `bindBodyPlayerId`
  überschreibt den `playerId` im Body, sodass die Bestellung unter dem falschen Konto entstand statt
  zu scheitern. Das war die Ursache des als P1-3 offen gebliebenen PayPal-Handoff-Flakes.
- Regelwerk: `scripts/agent-review-session.mjs` baut seinen Prompt selbst und liest
  `review-session-prompt.md` nie — Punkt 8 und die Schweregrad-Obergrenze fehlten dort vollständig,
  `DEFAULT_FOCUS` forderte weiter einen Test pro geändertem Pfad, also genau das Wachstum, das #530
  stoppen sollte. Beides übernommen und in beide Review-Workflows gezogen, damit nicht der gewählte
  Reviewmodus entscheidet, welche Testregeln gelten; beide lesen `server/TESTING.md` aus dem
  vertrauenswürdigen Base-Checkout, sobald der Diff `server/` berührt. Regel 4 erhält den begrenzten
  Negativfenster-Fall, den die Suite an fünf Stellen braucht, und die E2E-Definition dokumentiert
  `phase5eIsolation.e2e.test.ts` als die eine Datei ohne Browser.
- Sichtbare Änderung: Die Desktop-Navigationsleiste wird abgeglichen statt neu aufgebaut. Aussehen,
  Reihenfolge, Gruppierung und aktiver Zustand bleiben gleich; erwartete Wirkung ist allein, dass
  ein Klick während eines laufenden Refreshs nicht mehr verloren geht.
- Bewusst offen und im Bericht begründet: der Scribble-Flake (vermutlich schon durch #528 behoben,
  erst nachbeobachten), das Aufteilen von `flows.fixture.ts` und der
  Challenge-Rush-Katalogdurchlauf. Aus dem Cross-Review in ein eigenes Arbeitspaket ausgelagert: Der
  Arcade-Launcher baut sich beim Laden der Statistiken und bei Lobby-Signalen komplett per
  `innerHTML` neu auf und trägt damit dieselbe Tap-Race, die dieser PR für die Desktop-Leiste
  behebt.
- `NODE_ENV=test` im Integrationslauf aktiviert zusätzlich `POST /api/onboarding/test-complete`
  (vorher 404) und kürzere Battleship-Bot-Züge. Kein Test prüft den 404; die Route bleibt hinter
  `requireUser`.
