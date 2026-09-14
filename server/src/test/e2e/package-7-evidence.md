# Paket 7 – Offene Browserbelege

Basis: `9cfdea2338ad5848864fadc9b4bd83bf7ddc0ded` (aktuelles `origin/main` beim Start,
tatsächlicher Merge von [PR #626](https://github.com/blorbeer-cmd/LAN_2026/pull/626),
GitHub: gemergt am 14.09.2026, 10:12:54 UTC). Offene PRs #546, #497, #492, #486,
#440 und #249 ändern keine betroffenen E2E-Dateien oder Fixtures.

Normative Grundlage: externe Revision 4 `frontend-component-contract-plan-f53e69d8-v4.md`,
Paket 7, Abschnitt 8.1 und dessen Komponentenverweise. Der ursprüngliche Auftrag ergänzte
ausschließlich Browsernachweise. Ein ausdrücklicher Folgeauftrag behebt zusätzlich P7-01 mit
einer eng begrenzten Regel in `public/css/arcade.css`; Verträge, Registry, Referenzbilder,
Schwellen und CI-Konfiguration bleiben unverändert.

## Abdeckungsmatrix vor der Ergänzung

Dateinamen beziehen sich auf dieses Verzeichnis. Ergänzungen erweitern bestehende Tests;
es entsteht kein neuer Test-Owner und keine neue Partitionszuordnung.

| Bereich / Vertrag / erreichbarer Zustand | Vorhandener Test (Datei und Name) | Nachgewiesene Lücke / Ergänzung |
|---|---|---|
| Mitgliedszustände; Controls; Rollen laden fehlgeschlagen, Mitglied → Admin → Owner → Mitglied, Auswahl gesperrt | `authGate.e2e.test.ts`: `admin roster retries role loading, serializes changes and follows group role signals` | Zustandswirkung vorhanden; 32±1 px und Containeroverflow bei aktiver/gesperrter Rollenauswahl ergänzen. Retry: echte Textzeilen messen, Wachstum nur bei Umbruch, Desktop wieder einzeilig. |
| Mitgliedszustände; Controls; eingeladen/zugesagt | `eventInvitations.e2e.test.ts`: `manager invites a member who accepts and both open clients update` | Zwei echte Kontexte, Einladung, Enter-Annahme, beide sichtbaren Ansichten und Phone-Overflow vorhanden; kein zweiter Lebenszyklus nötig. |
| Bestellung/Kartenfooter; Controls; offen, bezahlt, abgeschickt, geschlossen | `foodOrders.fixture.ts`: `Essensbestellung: direkte Zahlung pro Personenblock und Lebenszyklus` und `Essensbestellung: orderer groups collapse/expand and pay as a group` | Zahlungszustände, Ausrichtung und stabile Markerbreite vorhanden; genaue Controlhöhe einschließlich Disabled, Footerbreite/-abstand und Reflow ergänzen. |
| Modalfehler; Modal/Controls; abgelehnter doppelter Spielname bleibt editierbar | `flowsShell.fixture.ts`: `Spiele: suggest a game (duplicate name rejected), promote it, then rate Bock/Skill inline` | Fehlermeldung vorhanden; erhaltene Eingabe, Fokuszyklus, 32±1 px und lokaler Overflow nach Fehler sowie gestapeltes Verwerfen ergänzen. |
| Destruktivbestätigung; Modal/Controls; Löschen abbrechen/bestätigen | `foodOrders.fixture.ts`: `Essensbestellung: direkte Zahlung pro Personenblock und Lebenszyklus` | Pointer-Abbruch und Löschung vorhanden; sicheres initiales Enter, Tab/Shift-Tab, Danger-Semantik, Fokus und Rückgabe ergänzen. |
| Fokuspfade; Modal, ActionMenu, RosterPicker, SelectionSearch, DateTimeField, EmptyState | `flowsShell.fixture.ts`: `shared dialogs preserve layout, trap focus and restore it after every confirm path`, `standard control variants center single lines and grow for wrapped content`, `global search filters areas, supports keyboard navigation and restores focus`; `flowsCompetition.fixture.ts`: `full click-through: players, matchmaking, voting, leaderboard, live pause`; `eventDatePoll.e2e.test.ts`: `confirmed participants use clear poll modes, finish a round and keep results separate from the event` | Basisgeometrie, echtes Wachstum, Such-/Kalender-/Menüfokus und Raster bereits vorhanden. Nur die konkreten Fehler-/Destruktivpfade oben ergänzen. |
| Arcade Mehrbenutzer; Controls; Gast unbereit/bereit/unbereit, Host-Start | `arcadeFlows.fixture.ts`: `Arcade: a lobby guest flags themselves ready and the host sees it`; `arcade.fixture.ts`: `Pong Doppel: mobile and desktop lobbies assign two full teams and start four players` | Synchronisierung vorhanden; Gast-Tastaturaktivierung, Controlhöhe in beiden Zuständen und Reflow beider Clients ergänzen. |
| Arcade Zuschauer; Controls; laufendes Quiz ohne geheime Frage, Ende mit Rückkehr | `arcade.fixture.ts`: `watch list: a finished match disappears and active watchers are sent back to the Arcade`; `arcadeFlows.fixture.ts`: `Arcade: a non-player can watch a running quiz without seeing the question` | Geheimhaltung und Lebenszyklus vorhanden; Watch-Aktion und tatsächlich scrollender Container bei 320 px/Reflow ergänzen. |
| Arcade KI; Controls; KI ausgewählt, Bot-Lobby, Flotte platzieren und schießen | `battleship.e2e.test.ts`: `Battleship: an admin starts a playable match against the AI` | Spielbarkeit vorhanden; aktive/gesperrte Setupcontrols und 32±1 px sowie tatsächliche Containerbreite ergänzen. |
| Arcade Live; Controls; sechs Spieler, Pause, Hostwechsel, Ergebnis | `arcade.fixture.ts`: `Tetris Arena supports six ready players across multiple opponent rows` | Mehrzeiliges Raster, Canvaserhalt, Hostwechsel und vollständige Ergebnisnamen vorhanden; Pausenstatus auf dem zweiten Client und dessen Controlgeometrie ergänzen. |
| TV-Kiosk; separate Strukturziele, Controls; Quiz → Canvas, Zuschauer-Eliminierung | `arcade.fixture.ts`: `the kiosk removes stale quiz markup before rendering a canvas game`, `Snake Arena elimination status updates in spectator and kiosk legends` | Zustandswechsel auf echten Clients vorhanden; TV-Container und 44-px-Fullscreen-Strukturziel bei 1440×900 ergänzen; bleibt Arcade. |

## Gezielte Szenen und Ressourcen

- Rollen: 320×568, 390×844, 1024×768; reale 503-Testantwort, Retry, gesperrte Auswahl während
  erneuter Anmeldung und Rollen-Signale. „Erneut versuchen“ hat auf Phones tatsächlich zwei
  Textzeilen (Range-Bounding-Boxes); seine rund 46 px sind deshalb zulässiges Wachstum.
- Bestellung: offener Footer bei 320×568, 640×768, 1440×900; geschlossener Footer und gesperrte
  Zahlungscontrols bei 512×384 und 720×450; bezahlte Gruppe bei 390×844 und Marker bei 320×720.
  Volle Footer-Containerbreite, 8-px-Aktionsabstand, keine Überlappung und kein Overflow.
- Modalfehler: realer 409-Konflikt für denselben Spielnamen; 512×384 und 720×450,
  unverlorener Entwurf, Tab/Shift-Tab, sichtbarer Fokus, Escape, sicheres Enter im
  Verwerfen-Dialog und Pointer-Bestätigung. Auf das Ende tatsächlich laufender Animationen
  warten; weder pauschale Pause noch Messung während der 0,96-Skalierung.
- Löschen: realer Wasser-Bestellposten, initial Abbrechen fokussiert, Tab zur Danger-Aktion,
  Shift-Tab/Enter bricht ab, Rückgabe an den Löschtrigger; anschließend Pointer-Löschung.
- Quiz-Lobby: getrennte Host-/Gastkontexte, Enter setzt bereit, Pointer nimmt Bereitschaft
  zurück, jeweils sichtbarer Hoststatus; Host 1024×768, Gast 320×568, gleiche Controlhöhe.
- Zuschauer: eigener Kontext, Watch-Aktion bei 320×568, sichere Quizansicht bei 320×568,
  512×384 und 720×450, keine Antwortcontrols, automatischer Rücksprung nach Host-Ende.
- KI: bestehender Battleship-Botpfad bei 390×844; Lobby und deaktivierte/aktive Setupcontrols.
- Live: sechs getrennte Kontexte; Hostpause erscheint beim Gast bei 390×844; Controlhöhen,
  Overflowprüfung, Hostwechsel und Ergebnisprüfung bestehen nach der Behebung von P7-01.
- Kiosk: eigener tokengebundener Read-only-Kontext bei 1440×900; Quiz → Snake-Canvas,
  kein Container-/Dokumentoverflow, Fullscreen-Strukturziel mindestens 44×44 px,
  Tab/Shift-Tab und sichtbarer Fokus. Keine Verschiebung nach Core.

Die sieben bestehenden Owner `authGate`, `flowsShell`, `foodOrders`, `arcade`,
`arcadeMultiplayer`, `arcadeFlows` und `battleship` bleiben ihren bisherigen Partitionen
zugeordnet. Der lokale Footerhelfer wird unmittelbar im vorhandenen Bestell-Lebenszyklus
geprüft. Gemeinsame Hilfen bleiben unverändert. Die betroffenen kurzlebigen Kontexte verwenden
den vorhandenen `deferE2EContextClose`: Fehleraufnahmen entstehen vor dem Schließen;
danach schließt der Diagnose-Wrapper die Kontexte auch bei Fehlern. Der absichtlich getestete
Host-Disconnect bleibt ein sofortiges Schließen. Jeder Owner beendet seinen eigenen Server
und Browser über den bestehenden Teardown; Ports und Datenbanken bleiben isoliert.

## Behobener Produktbefund P7-01: Tetris-Gastansicht lief horizontal über

Reproduktion im unveränderten Produktstand von Paket 6:

1. `npm run test:e2e:prepare` in `server/`.
2. `NODE_ENV=test E2E_FAST_TIMERS=1 E2E_TRACE=1 node --test dist-test/test/e2e/arcadeMultiplayer.e2e.test.js`
   (unter PowerShell die drei Variablen mit `$env:NAME='Wert'` setzen).
3. Bestehender Test `Tetris Arena supports six ready players across multiple opponent rows`:
   sechs Accounts/Browserkontexte, Arena starten, Host pausieren, Gastansicht messen.

Erwartet: `#view-container.scrollWidth <= clientWidth` bei 390×844. Tatsächlich wiederholt
**388 > 380 px**, also 8 px horizontaler Überlauf. Die Pause ist beim Gast sichtbar;
Host-/Gastcontrols erfüllen 32±1 px. Keine reale Kind-Border-Box ragt über den rechten Rand.
Konkreter Ursachenverdacht: `.tetris-boards::before` in `public/css/arcade.css` mit
`inset: -24px`; der bestehende Schutz gilt nur für `.arcade-game-shell.is-expanded`,
der Gast verwendet die normale Ansicht. Diese Eingrenzung ist keine abschließende Ursachenprüfung.

Lokale Diagnose: `server/test-results/package-7/diagnosis-3/`
`tetris-arena-supports-six-ready-players-across-multiple-opponent-rows-51848/`:
`metadata.json`, `browser.log`, `server.log`, sechs Screenshots/DOMs und sechs Playwright-Traces.
`page-2-1.png` zeigt die pausierte Gast-Spielfläche. Der gleiche Wert wurde bereits in
`diagnosis-2` gemessen. Die Assertion wurde weder gelockert noch übersprungen; Referenzen blieben
unverändert. Der Folgeauftrag verschiebt die bereits für den Expanded-Modus vorhandene Kapselung
des dekorativen Pseudoelements auf `.tetris-boards` selbst. Dadurch gilt sie auch in der normalen
Gastansicht, ohne Board-, Raster- oder Controlgeometrie zu ändern. Der erneute vollständige Owner
läuft 3/3 grün und erreicht Hostübergabe und Ergebnisprüfung.

## Lokale Bildvergleiche

Alle 17 Actual-/Diff-Paare des Ausgangslaufs wurden einzeln angesehen; alle vorgeschalteten
semantischen Assertions dieser Bildszenen bestanden. Keine Referenzdatei wurde geändert.

| Szene | Sichtprüfung unter Windows |
|---|---|
| `core-admin-row-390`, `core-admin-row-1024` | Name, Badge und Aktion lesbar; Unterschiede an Schrift und aktionsabhängiger Breite. |
| `core-filters-390`, `core-filters-1024` | Ganze Filtercontrols und Reihen vollständig; Abweichungen an Text und entsprechenden Controlkanten. |
| `core-footer-390`, `core-footer-1024` | Footerlinie und Aktion vollständig; Text-/Buttonbreiten unterscheiden sich. |
| `core-form-390`, `core-form-1024` | Alle drei Felder, Hilfe und Submit sichtbar; andere Textmetriken und daraus folgende vertikale Abstände/Bildhöhe. |
| `core-modal-390`, `core-modal-1024` | Header, Schließen und Formular vollständig; vertikale Lage/Bildhöhe weicht ab. |
| `core-roster-390`, `core-roster-1024` | Auswahl, Toolbar und Namen vollständig; zweizeiliger Adminname auf Phone, Unterschiede an Text/Zeilenhöhe. |
| `core-tabs-390`, `core-tabs-1024` | Beide Tabs lesbar; Text und bei Desktop die inhaltsabhängigen Breiten weichen ab. |
| `arcade-create-320`, `arcade-create-390`, `arcade-create-1024` | Drei-/Zwei-/Einzeilenlayout vollständig; Abweichungen hauptsächlich an Textkanten. |

Das sind **fehlgeschlagene lokale Bildvergleiche**, kein Nachweis von Harmlosigkeit aufgrund
des Betriebssystems. Der gleiche gepushte Head muss zusätzlich im Ubuntu-Referenzprofil bestehen.
Tetris-Overflow und Serverstartfehler sind ausdrücklich keine Bildprofilabweichungen.

## Prüfungen und Laufzeit

Ausführung unter Windows mit Node.js 24.18.0; Befehle in `server/`, sofern nicht anders
angegeben. Builds wurden nach `npm run test:e2e:prepare` beziehungsweise nach Änderungen
mit `npm run test:compile` vorbereitet und für die Partitionsläufe wiederverwendet.

| Prüfung | Ergebnis |
|---|---|
| Tetris-Fix: `node --test --test-concurrency=1 dist-test/test/e2e/arcadeMultiplayer.e2e.test.js` mit `E2E_TRACE=1` | 3/3 bestanden, 0 übersprungen; normale Arena, Expanded-Modus und Pong-Doppel vollständig. |
| Gezielte sieben bestehende Owner mit `node --test --test-concurrency=1` und `E2E_TRACE=1` vor dem Folgefix | Alle ergänzten Szenen ausgeführt. Nach Korrektur der Textzeilen-/Animationsmessung bleibt nur P7-01 rot; abschließende Wiederholung von `flowsShell` und `arcadeMultiplayer`: 19/20 bestanden, 0 übersprungen. |
| `node --test scripts/run-e2e-partition.test.mjs dist-test/test/e2eDiagnostics.test.js dist-test/test/visualComparison.test.js` | 25/25 bestanden; Partitionszuordnung und vorhandene Diagnose-/Vergleichshilfen. |
| `npm run test:e2e:run:core` | 40/71 bestanden, 31 fehlgeschlagen, 0 übersprungen: 29 Tests durch Serverstart-Hooks blockiert, zwei Bildvergleichstests mit 14 Szenen fehlgeschlagen. |
| Sechs durch Serverstart blockierte Core-Owner einzeln mit `node --test --test-concurrency=1` | 29/29 bestanden: `access`, `authGate`, `checklist`, `eventInvitations`, `eventWorkspaceSwitch`, `eventDatePoll`. Ersetzt keinen grünen parallelen Vollauf. |
| `npm run test:e2e:run:arcade` vor dem Folgefix | 33/35 bestanden, 0 übersprungen: P7-01 und ein Bildvergleichstest mit drei Szenen fehlgeschlagen. |
| `npm run test:e2e:run:arcade` nach dem Folgefix | 34/35 bestanden, 0 übersprungen: sämtliche Runtime-Szenen einschließlich Tetris bestehen; nur der erwartete lokale Windows-Bildvergleich mit drei Szenen schlägt fehl. |
| `npm run test:e2e:run:arcade-smoke` | 3/4 bestanden, 0 übersprungen: nur Bildvergleich fehlgeschlagen. |
| `npm test` | 1114/1114 plus 413/413 bestanden; keine Arbeitsbaumänderung während des Laufs. |
| `npm run lint`, `npm run format:check`, `npm run build` | Bestanden. |
| `npm run check:tokens`, `npm run check:components` | Bestanden; Komponentenprüfung: 0 Verstöße, 0 Registrydiagnosen. |
| `git diff --check`, `git diff --cached --check` im Repositorywurzelverzeichnis | Bestanden. |

Die gezielten Läufe verwenden die unveränderten kompilierten Owner unter
`dist-test/test/e2e/<Owner>.e2e.test.js`, `NODE_ENV=test` und `E2E_FAST_TIMERS=1`.
Protokolle: `server/test-results/package-7/` (`targeted.log`, `diagnosis-3.log`,
`core-startup-diagnosis.log`, `final-core.log`, `final-arcade.log`, `final-smoke.log`,
`support-tests.log`, `npm-test.log` und die einzelnen statischen Prüfprotokolle).

Gesonderter Runtimebefund P7-02: Beim parallelen Core-Vollauf binden einzelne Testserver
nicht innerhalb des bestehenden 10-Sekunden-Startlimits ihren Port. Schon der unveränderte
Ausgangsstand hatte 15 solche Hook-Fehler; der Schlusslauf hat 29. Dieselben sechs Owner
bestehen seriell. Die Ursache des Parallelstartproblems bleibt offen; weder Timeout noch
Parallelität des Standardrunners wurden verändert. Turnier-, Quiz- und Scribble-Laufzeitfehler
aus den Hinweisen zu PR #626 wurden in den abschließenden ausführbaren Szenen nicht reproduziert.

| Suite | Lokaler Ausgangslauf | Lokaler Schlusslauf | Differenz | Median der letzten fünf erfolgreichen Main-CI-Suiten |
|---|---:|---:|---:|---:|
| Core | 72,296 s | 53,571 s | −18,725 s | 80 s |
| Arcade | 62,146 s | 53,930 s | −8,216 s | 92 s |
| Arcade-Smoke | nicht separat erhoben | 6,142 s | nicht bestimmbar | 6 s |
| Unit/Integration | nicht separat erhoben | 45,345 s + 13,473 s Testprozesse | nicht bestimmbar | 61 s |

Die lokalen roten Läufe mit abgebrochenen Szenen liefern **keinen belastbaren Nachweis eines
Performancegewinns oder eines eingehaltenen Laufzeitbudgets**. Gemäß bestehender Repositoryregel
wurde die Historie mit `scripts/ci-test-performance.mjs` aus erfolgreichen Main-Suiten erhoben:
Core/Arcade aus Runs `34832045494`, `34825267768`, `34786261706`, `34769872848`, `34756095205`;
Smoke aus `34566315122`, `34300713656`, `34262616410`, `34261419292`, `34218218145`;
Unit/Integration aus `34832045494`, `34827914577`, `34825267768`, `34786261706`, `34769872848`.
Rohwerte und Quellen stehen lokal in `performance-history.json`. Der vergleichbare CI-Zuwachs
zum jeweiligen Median und die CI-Verweise des gepushten Heads werden im PR ergänzt.
Die Performancekonfiguration bleibt unverändert. Kein offener oder fehlgeschlagener
Abnahmepunkt gilt allein durch diese Matrix als bestanden.
