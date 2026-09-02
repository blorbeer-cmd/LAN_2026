# Audit der bestehenden Test-Suite

Stand: 2026-09-01, Basis `main` @ `d326a4b` (nach PR #530).
Maßstab: die verbindlichen Test-Design-Regeln in [`server/TESTING.md`](../../server/TESTING.md).

Reiner Analyseauftrag. Es wurde kein Test, kein Produktionscode und keine Testkonfiguration
geändert; die einzige Änderung dieses Arbeitspakets ist dieses Dokument.

## 0. Umsetzungsstand (Nachtrag 2026-09-01)

Der Bericht selbst bleibt als Momentaufnahme des Bestands unverändert. Dieser Abschnitt hält fest,
was daraufhin tatsächlich geändert wurde.

| Finding | Stand | Umsetzung |
|---|---|---|
| P1-1 Retry-Schleifen | behoben | `app.js` gleicht die Desktop-Navigation in place ab statt sie zu ersetzen (`renderDesktopNavigation`, delegierter Listener); alle drei Retry-Schleifen entfernt |
| P1-2 Schlaf-Pausen nach Login | behoben | `#app[data-player-data]` publiziert `loading`/`ready`/`failed`; `waitForPlayerData()` ersetzt sechs feste Pausen |
| P1-3 PayPal-Handoff-Flake | **offen** | Ursache nicht belegt; unverändert |
| P2-1 Arcade-Countdowns | behoben | `ARCADE_FAST_TIMERS` in `timing.ts`, `npm test` setzt es; `END_REVEAL_MS` zentralisiert |
| P2-2 `api.agentDownload` | behoben | `AGENT_DIST_DIR` + lazy `agentExePath()`; Test packt einen Stub, beide Zweige unbedingt geprüft |
| P2-3 `openView`-Pausen | behoben | wartet auf `#view-container[data-view=…]`, Options-Schleife auf die Antwort |
| P2-4 Doppel-Duplikat | behoben | Blobby-Doppel-Browsertest entfernt, Begründung im Code |
| P2-5 Scribble-Flake | bewusst offen | vermutlich durch #528 behoben; erst nachbeobachten |
| P2-6 30-s-Standardtimeout | behoben | `E2E_DEFAULT_TIMEOUT_MS` (15 s) je registriertem Kontext; 4-s-Adhoc-Werte entfernt |
| P2-7 Geometrie-Assertions | teilweise | die beiden exakten Rect-Vergleiche haben jetzt 1 px Toleranz; DOM-Reihenfolge-Assertions unverändert |
| P3-1 `phase5eIsolation` | behoben | Settle-Pause an das positive Ereignis gekoppelt; E2E-Definition in `TESTING.md` korrigiert |
| P3-2 `flows.fixture.ts` aufteilen | bewusst offen | laut Bericht ein eigener PR |
| P3-3 `format.test.js` | behoben | literale Erwartung statt Nachbau der Implementierung |
| P3-4 `waitForAction` | behoben | `Promise.race` zweier `waitFor` statt 280×25 ms Polling; Klick-Taktung unverändert |
| P3-5 Katalogdurchlauf | **offen** | 24,2 s unverändert; Messung des `sleep(35)`-Anteils steht aus |
| R-1 Review-Launcher | behoben | `DEFAULT_FOCUS` risikobasiert, Punkt 8 und die `low`-Voreinstellung in den erzeugten Prompt übernommen |
| R-2 Review-Workflows | behoben | beide Prompts tragen Punkt 8 und die Schweregrad-Einordnung |
| R-3 Ausnahme aus Regel 4 | behoben | in Punkt 8 ergänzt |
| R-4 Negativfenster | behoben | Regel 4 um den Fall erweitert; fünf Stellen im Code entsprechend benannt |
| R-5 E2E-Definition | behoben | Ausnahme in `TESTING.md` dokumentiert |

Gemessene Wirkung auf den Unit-/Integrationslauf (`node --test`, dieselbe Maschine):

| | vorher | nachher |
|---|---|---|
| gesamter gemessener Schritt | 79,9 s | **54,9 s** |
| `api.battleship` | 19,5 s | 1,2 s |
| `api.scribbleThumbsAndFavorites` | 16,2 s | 4,5 s |
| `api.agentDownload` | 14,9 s | 0,7 s |
| `api.tetrisArena` | 7,4 s | 1,4 s |
| `api.arcadeMatchLeave` | 7,0 s | 1,1 s |
| `api.blobbyMultiplayer` | 6,9 s | 1,0 s |
| `api.pongMultiplayer` | 6,8 s | 1,0 s |
| `arcade.snakeArena` | 3,9 s | 1,0 s |

Unverändert: `api.challengeRush` (24,2 s — P3-5 offen) und `db.migrations` (18,2 s, nicht untersucht).

Die Browser-E2E-Suiten konnten lokal nicht ausgeführt werden (kein Chromium in der Arbeitsumgebung).
Alle E2E-Änderungen sind ausschließlich durch Typecheck, Lint und Codeanalyse abgesichert; CI ist
dafür die eigentliche Prüfung.

## 1. Datenbasis

Belastbare Messungen statt Schätzungen, erhoben aus CI-Läufen auf `main` und aus einem lokalen
Lauf ohne Dateiänderung (`npm run test:compile` + `node --test`, Ausgabe in ein Scratch-Verzeichnis;
`dist/` und `dist-test/` sind ohnehin ignoriert).

### CI-Laufzeiten (`main` @ `d326a4b`, Lauf 1566)

| Schritt | Dauer |
|---|---|
| Run measured unit and integration tests | 71 s |
| Run measured Core E2E (all) | 59 s |
| Run measured Arcade E2E | 108 s |

### Lokale Einzelmessung je Testdatei (isoliert, inkl. ~0,25 s Prozessstart)

Summe über alle 200 Dateien: **203 s**. Die fünf teuersten Dateien machen davon 46 % aus.

| Datei | Dauer |
|---|---|
| `src/test/api.challengeRush.test.ts` | 24,2 s |
| `src/test/api.battleship.test.ts` | 19,5 s |
| `src/test/db.migrations.test.ts` | 19,4 s |
| `src/test/api.scribbleThumbsAndFavorites.test.ts` | 16,2 s |
| `src/test/api.agentDownload.test.ts` | 14,9 s |
| `src/test/api.tetrisArena.test.ts` | 7,4 s |
| `src/test/api.arcadeMatchLeave.test.ts` | 7,0 s |
| `src/test/api.blobbyMultiplayer.test.ts` | 6,9 s |
| `src/test/api.pongMultiplayer.test.ts` | 6,9 s |

Frontend- und Skript-Suiten (`public/js/**/*.test.js`, `scripts/*.test.mjs`): 384 Tests in
**2,2 s**. Dieser Teil ist unauffällig und kommt unten nur als Gegenbeispiel vor.

### Belegte Fehlschläge auf `main` (letzte 12 Läufe)

| Lauf | Datum | Fehlgeschlagener Test | Fehlerbild | Wiederholung allein |
|---|---|---|---|---|
| 1556 | 2026-09-01 08:39 | `flows.fixture.ts` „Orga Events tab und Profil …“ | `days before the event start are disabled` | — (Kalendertag) |
| 1554 | 2026-09-01 06:54 | dito | dito | — (Kalendertag) |
| 1548 | 2026-08-31 21:00 | grün | | |
| 1544 | 2026-08-31 19:18 | `arcade.fixture.ts` „Scribble: live thumbs-up …“ | `waitForFunction: Timeout 30000ms` | 12,7 s, grün |
| 1529 | 2026-08-31 09:46 | `flows.fixture.ts` „Essensbestellung: PayPal-Handoff …“ | `locator.waitFor: Timeout 30000ms` | 7,8 s, grün |

Vier rote `main`-Läufe in zwölf. Zwei davon sind der bereits behobene Kalendertagsfehler, zwei sind
echte, nicht-deterministische Fehlschläge, die im gezielten Einzel-Retry in 8–13 s durchliefen.

## 2. Findings

### P1 — hohes Risiko für falsches Vertrauen oder häufige Flakes

---

#### P1-1 Navigations-Retry-Schleifen in den Arcade-Fixtures verdecken eine reale UI-Race

**Datei / Testgruppe:** `server/src/test/e2e/arcade.fixture.ts:120-132` (`navigateToArcade`),
`:138-152` (`openArcadeGame`), `server/src/test/e2e/challengeRush.fixture.ts:75-87` (`openArcade`).
Betrifft praktisch jeden Test der Arcade-Partition, weil alle über diese Helfer einsteigen.

**Problem:** Drei Helfer wiederholen einen Navigationsklick bis zu dreimal und schlucken die
Fehler dabei still (`.catch(() => undefined)` plus leerer `catch`-Block). Die Kommentare benennen
die Ursache selbst als Produktionsverhalten:

- `arcade.fixture.ts:122-123`: „Freshly created players still broadcast `players:changed` refreshes
  that can replace the mobile ‚Mehr‘ view or a direct desktop item mid-click.“
- `arcade.fixture.ts:148-149`: „A realtime refresh can replace the launcher during the click.“
- `challengeRush.fixture.ts:82-83`: „A late realtime refresh can replace the navigation target.“

**Warum problematisch:** Regel 5 ist hier eindeutig — „Ein sporadisch fehlschlagender Test gilt
als defekt und wird ursächlich behoben, nicht durch größere Timeouts, **zusätzliche Retries**,
schwächere Assertions oder Überspringen. Retries bleiben reine Diagnose- und Infrastrukturhilfe“.
Diese Retries sind das Gegenteil: sie sind die Lösung, sie liegen im Test statt in der
Infrastruktur, und sie machen einen roten Lauf grün. Gravierender ist die fachliche Seite: was die
Helfer umgehen, trifft echte Nutzende genauso. Wer im Moment eines `players:changed`-Broadcasts
auf „Arcade“ tippt, klickt auf einen Knoten, den das Re-Rendering gerade ersetzt hat — der Tap
verpufft. Das berührt Produktziel 1 (ein neu verbundener Client darf andere nicht beeinträchtigen)
und Produktziel 2 (wichtige Aktionen in wenigen Schritten). Die Suite kennt den Defekt,
dokumentiert ihn dreimal im Kommentar und versteckt ihn dreimal.

**Überlappende Abdeckung:** keine. Kein Test prüft, dass die Navigation einen gleichzeitigen
Realtime-Refresh übersteht — das Verhalten ist ausschließlich als Retry im Testhelfer beschrieben.

**Empfohlene Maßnahme:** Ursache im Frontend beheben (Navigation nicht neu aufbauen bzw.
Klickziel stabil halten, während ein `players:changed`-Refresh läuft), danach die drei
Retry-Schleifen ersatzlos entfernen. Bis die Produktionsseite steht: die Schleifen laut machen —
den letzten Fehler nicht verwerfen, sondern in die Abbruchmeldung übernehmen, damit ein echter
Navigationsbruch nicht als „could not navigate to Arcade“ ohne Ursache endet. Ein zusätzlicher Test
für die Race ist ausdrücklich **nicht** gemeint; der Fix macht die vorhandenen Tests wieder
aussagekräftig.

**Weiterhin erkannte Regression:** unverändert alles, was die Arcade-Tests heute prüfen — nur ohne
den Filter, der genau diese eine Klasse von Fehlern wegdämpft. Nach dem Fix erkennt jeder
Arcade-E2E-Test einen Rückfall in die Race, weil er dann rot wird statt still zu wiederholen.

**Risiko der Änderung:** hoch, wenn man nur die Retries entfernt und die Produktionsseite offen
lässt — dann wird die bisher versteckte Race zu sporadisch roten Läufen. Die Reihenfolge ist
deshalb bindend: erst Ursache, dann Retry-Abbau. Bis dahin ist der laute Retry der sichere
Zwischenschritt.

---

#### P1-2 Fünf Schlaf-Pausen in `authGate.e2e.test.ts` kaschieren einen realen Boot-Order-Defekt

**Datei / Testgruppe:** `server/src/test/e2e/authGate.e2e.test.ts:131`, `:340`, `:422`, `:713`,
`:740` (jeweils `waitForTimeout(500)`), `:572` (`waitForTimeout(300)`). Core-Domäne `auth`.

**Problem:** Nach jedem `waitForSelector('#app:not([hidden])')` folgt eine feste Pause. Der
Kommentar an `authGate.e2e.test.ts:126-130` beschreibt, wogegen sie schützt:

> „#app unhides as soon as the gate resolves, before main()'s subsequent loadAll() populates
> state.players — navigating to Profile before that finishes would find no matching player and
> show the ‚pick an identity‘ fallback instead of the real profile (with its Logout button). A
> brief settle avoids racing that unrelated, pre-existing boot-order timing.“

An `:340` steht nur noch `// see the comment on the previous test`; an `:422`, `:713`, `:740` und
`:572` fehlt jede Begründung — die Pause ist zur Gewohnheit geworden.

**Warum problematisch:** Der Kommentar beschreibt keinen Testartefakt, sondern ein
nutzersichtbares Fehlverhalten: Wer direkt nach dem Login auf „Profil“ tippt, sieht die
Identitätsauswahl statt seines Profils. Der Test weiß das, wartet 500 ms und prüft es nie. Regel 4
verbietet genau diese Konstruktion („`waitForTimeout`, `setTimeout` als Synchronisationshilfe und
vergleichbare Pauschalwartezeiten sind unzulässig“); die Ausnahme greift nicht, weil hier keine
produktive Frist verstreicht, sondern ein Ladevorgang abgewartet wird. Zweitens ist die Pause
größenabhängig: 500 ms reichen auf einem freien Runner und sind bei der unten (P2-6) belegten
3-fachen Lastspreizung nicht mehr garantiert.

**Überlappende Abdeckung:** keine — der Boot-Order-Zustand selbst ist nirgends abgedeckt.

**Empfohlene Maßnahme:** Ursächlich im Frontend beheben: `#app` erst freigeben, wenn `loadAll()`
den Grundzustand geladen hat, oder einen beobachtbaren Boot-Zustand publizieren (etwa ein
`data-*`-Attribut am `#app`), auf den die Tests dann warten. Danach alle sechs Pausen durch das
Warten auf diesen Zustand ersetzen. Der Ersatz ist eine Zeile pro Stelle.

**Weiterhin erkannte Regression:** alle bisherigen Assertions dieser Tests, zusätzlich der
Boot-Order-Zustand selbst — ein Rückfall lässt die Wartebedingung auflaufen, statt sich in einer
zufällig zu kurzen Pause zu verstecken.

**Risiko der Änderung:** niedrig für die Tests, mittel für das Frontend, weil der Zeitpunkt der
Freigabe von `#app` das wahrgenommene Ladeverhalten verschiebt. Ein reiner Marker-Zustand ohne
Änderung der Freigabe ist die risikoärmere Variante und behebt die Testseite vollständig.

---

#### P1-3 Belegter Flake: „Essensbestellung: PayPal-Handoff … bleibt synchron“

**Datei / Testgruppe:** `server/src/test/e2e/flows.fixture.ts:2882` (Test), Fehlerstelle im Helfer
`openScenario`, `flows.fixture.ts:2913-2927`. Owner `foodOrders.e2e.test.ts`, Core-Domäne `flows`.

**Problem:** In Lauf 1529 lief `group.locator('.food-order-group-header').waitFor()` in den
impliziten 30-Sekunden-Timeout; derselbe Test lief im gezielten Owner-Retry in 7,8 s durch. Der
Primärfehler blockierte über die Cascade Suppression drei weitere Food-Order-Tests. Im grünen
Retry-Lauf steht außerdem ein `[console.error] Failed to load resource: … 409 (Conflict)`
unmittelbar vor dem betroffenen Test.

Der Helfer trägt bereits einen Workaround für eine frühere Ausprägung desselben Flakes
(`flows.fixture.ts:2915-2918`): „Use the generated id instead of the title: a failed/retried
scenario can leave an older card with the same title in the shared test event. Matching that card
makes the following group wait hang …“. Der Flake ist also nicht neu, sondern in neuer Form
zurückgekehrt.

**Warum problematisch:** Regel 5 verlangt ursächliche Behebung. Die bisherige Reaktion war eine
robustere Selektion (Symptom), nicht die Beseitigung der Zustandsüberlagerung zwischen den
Szenarien. Solange die Ursache offen ist, kostet jeder Treffer einen roten `main`-Lauf plus drei
verdeckte Geschwistertests. Die dokumentierte Owner-Ausnahme deckt das nicht ab: sie erlaubt
geteilten Zustand zwischen Geschwistertests, nicht Nicht-Determinismus innerhalb desselben Laufs —
der Retry führte dieselbe Datei in derselben Reihenfolge aus und war grün.

**Überlappende Abdeckung:** Die Freshness-Regeln selbst (gelöschte Position, bereits bezahlt,
entfernter PayPal-Link) sind serverseitig in `src/test/api.foodOrders.test.ts` abgedeckt; der
Browsertest deckt zusätzlich den PayPal-Popup-Handoff und die Toast-Rückmeldung ab, also einen
echten Integrationsnutzen. Der Test ist nicht redundant — nur instabil.

**Empfohlene Maßnahme:** Ursache eingrenzen und beheben, nicht die Selektion weiter härten.
Konkrete Ansatzpunkte in dieser Reihenfolge: (1) den 409 im Browser-Netzwerkprotokoll zuordnen —
`createScenario` legt über `page.request.post` eine neue Sammelbestellung an, während der
Single-Open-Guard in `src/routes/foodOrders.ts` möglicherweise noch eine offene Bestellung des
vorigen Szenarios sieht; `cleanupScenario` löscht zwar, aber erst am Ende jedes Falls und ohne
Bestätigung, dass die Liste im Browser den Löschvorgang bereits verarbeitet hat. (2) Prüfen, ob
`openScenario` nach `page.reload()` auf einen Realtime-Refresh trifft, der die Karte zwischen
`card.waitFor()` und dem Gruppen-Wait neu aufbaut. Die vorhandenen Diagnoseartefakte des Laufs
(Screenshot, DOM-Snapshot, Server-Output) sind für Lauf 1529 sieben Tage lang verfügbar gewesen
und für eine Nachanalyse der Startpunkt.

**Weiterhin erkannte Regression:** unverändert der vollständige PayPal-Handoff im Browser inklusive
der drei Freshness-Fälle und der Popup-Härtung.

**Risiko der Änderung:** niedrig bis mittel. Wird die Ursache in der Testabfolge gefunden, ist die
Korrektur lokal. Liegt sie im Produktionscode (Single-Open-Guard oder Realtime-Refresh der
Bestellliste), ist der Fix wertvoller als der Test und entsprechend sorgfältig zu prüfen.

**Unsicherheit:** Die genaue Ursache ist aus den Logs allein nicht bewiesen. Belegt sind der
Fehlschlag, die Fehlerstelle, die erfolgreiche Wiederholung und der 409 im Browserprotokoll; die
Verknüpfung dieser drei ist eine begründete Hypothese, keine Feststellung.

---

### P2 — relevantes Stabilitäts-, Wartbarkeits- oder Laufzeitproblem

---

#### P2-1 Die Arcade-Socket-Integrationstests warten 56 s lang auf echte 3-Sekunden-Countdowns

**Datei / Testgruppe:** `server/package.json` (`test:run`) im Zusammenspiel mit
`server/src/arcade/timing.ts:15-17`. Betroffen: `api.battleship`, `api.scribbleThumbsAndFavorites`,
`api.tetrisArena`, `api.arcadeMatchLeave`, `api.blobbyMultiplayer`, `api.pongMultiplayer`,
`arcade.snakeArena`.

**Problem:** `resolveArcadeTiming` liefert 3000 ms Countdown, sofern nicht `NODE_ENV=test` **und**
`E2E_FAST_TIMERS=1` gesetzt sind. Gesetzt werden beide nur von den E2E-Skripten
(`cross-env NODE_ENV=test E2E_FAST_TIMERS=1 …`). `test:run` setzt ausschließlich `DB_FILE=:memory:`.
Jeder Socket-Integrationstest, der ein Match startet, wartet damit den vollen Produktions-Countdown
ab. Zusätzlich greift `src/arcade/battleship.ts:17` (`BOT_TURN_MS = NODE_ENV === 'test' ? 20 : 650`)
in der Integrationssuite ebenfalls nicht.

Gemessen, jeweils dieselbe Datei mit und ohne die beiden Flags, alle Tests in beiden Läufen grün:

| Datei | heute | mit `NODE_ENV=test E2E_FAST_TIMERS=1` | Ersparnis |
|---|---|---|---|
| `api.battleship.test.ts` | 19,48 s | 1,19 s | −18,3 s |
| `api.scribbleThumbsAndFavorites.test.ts` | 16,17 s | 4,53 s | −11,6 s |
| `api.tetrisArena.test.ts` | 7,42 s | 1,46 s | −6,0 s |
| `api.arcadeMatchLeave.test.ts` | 6,99 s | 1,10 s | −5,9 s |
| `api.blobbyMultiplayer.test.ts` | 6,92 s | 1,02 s | −5,9 s |
| `api.pongMultiplayer.test.ts` | 6,84 s | 0,96 s | −5,9 s |
| `arcade.snakeArena.test.ts` | 3,90 s | 1,02 s | −2,9 s |
| **Summe** | **67,7 s** | **11,3 s** | **−56,4 s** |

**Warum problematisch:** 56,4 s sind 28 % der gesamten isolierten Unit-/Integrationslaufzeit
(203 s) und werden ausschließlich mit Warten auf Zeit verbracht. Der Countdown ist in keinem dieser
Tests Prüfgegenstand — geprüft werden Lobby-Gates, Team-Zuordnung, Thumbs-up, Leave-Persistenz,
Bot-Verhalten. Die Ausnahme aus Regel 4 (echte Frist, die selbst Prüfgegenstand ist) greift daher
nicht. Der Mechanismus, um es richtig zu machen, existiert bereits, ist produktionssicher gegen
`NODE_ENV` abgesichert und wird für die Browsersuite auch genutzt — nur die Integrationssuite
schaltet ihn nicht ein.

**Überlappende Abdeckung:** Der Produktionswert von 3000 ms ist unabhängig durch
`server/src/arcade/timing.test.ts` abgedeckt, inklusive der Fälle „Flag ohne `NODE_ENV=test`“ und
„`NODE_ENV=production` mit gesetztem Flag“. Es geht also keine Zusicherung verloren.

**Empfohlene Maßnahme:** In `test:run` (und `test:coverage`) `NODE_ENV=test` und
`E2E_FAST_TIMERS=1` mitgeben. Sauberer, weil der Name `E2E_FAST_TIMERS` sonst irreführend wird:
einen neutralen Namen einführen (etwa `ARCADE_FAST_TIMERS`), den `resolveArcadeTiming` zusätzlich
akzeptiert, und ihn in beiden Testprofilen setzen. Fachlich ändert sich nichts.

**Weiterhin erkannte Regression:** alle Assertions dieser sieben Dateien unverändert; der
Produktions-Countdown bleibt durch `timing.test.ts` geschützt.

**Risiko der Änderung:** gering, aber nicht null. `NODE_ENV=test` aktiviert zwei weitere
Verzweigungen: `src/arcade/battleship.ts:17` (kürzere Bot-Züge — erwünscht) und
`src/routes/onboarding.ts:237` (die Route `POST /api/onboarding/test-complete` antwortet dann
nicht mehr mit 404). Kein Test prüft diesen 404; die Route bleibt hinter `requireUser`. Zusätzlich
sollte man die sieben Dateien einmal auf Assertions gegen konkrete Countdown-Dauern durchsehen —
im Rahmen dieses Audits wurde keine gefunden, und der Probelauf war grün.

---

#### P2-2 `api.agentDownload.test.ts`: 14,9 s für ein 92-MB-ZIP, mit umgebungsabhängigen Assertions

**Datei / Testgruppe:** `server/src/test/api.agentDownload.test.ts` (100 Zeilen, 6 Tests),
insbesondere `:51-54` und `:62-83`.

**Problem:** Zwei Tests fordern `GET /api/agent-download` real an. Der Handler
(`src/routes/agentDownload.ts:139-153`) packt dabei `server/agent-dist/respawn-agent.exe` — eine
committete Datei von **92 MB** — mit `archiver`, `zlib` Level 9, in einen Stream, den supertest
vollständig puffert. Gemessen 9,88 s bzw. 7,51 s, zusammen 17,4 s der 135,6 s CPU-Zeit der
Gesamtsuite (13 %) und 14,9 s der isolierten Dateilaufzeit.

Der erste dieser beiden Tests prüft danach genau eine Sache: `assert.equal(res.status, 200)`.

Zusätzlich sind die Assertions des zweiten Tests an die Umgebung gekoppelt:

```ts
const exeExists = fs.existsSync(path.join(__dirname, '..', '..', 'agent-dist', 'respawn-agent.exe'));
…
if (exeExists) { /* 4 Assertions auf ZIP-Header, Dateiname, PK-Magic */ }
else          { /* 2 Assertions auf den 503-Pfad */ }
```

**Warum problematisch:** Zwei getrennte Probleme. Erstens die Laufzeit: 17,4 s, um einen
ZIP-Header und einen Statuscode zu prüfen, ist das mit Abstand schlechteste Verhältnis der Suite.
Zweitens — und schwerer — schaltet der Test seine eigenen Zusicherungen abhängig davon ab, was
zufällig auf der Platte liegt. In jedem Checkout oder Deployment ohne die Exe verschwinden die vier
Erfolgspfad-Assertions ersatzlos und der Test bleibt grün. Genau das ist „falsches Vertrauen“ im
Sinne der Bewertungsregel. Heute ist die Exe committet, das Risiko also latent — deshalb P2 und
nicht P1.

**Überlappende Abdeckung:** Der 503-Pfad ist bereits deterministisch abgedeckt — der letzte Test
der Datei (`:85-100`) stubbt `fs.existsSync` genau dafür, mit der Begründung „exercised
deterministically regardless of the actual repo state“. Die `else`-Hälfte des ZIP-Tests ist damit
schon heute redundant.

**Empfohlene Maßnahme:** Dasselbe Stubbing-Muster auf den Erfolgspfad anwenden: `EXE_PATH` bzw.
`fs` so umlenken, dass eine kleine temporäre Datei gepackt wird. Die Assertions (Content-Type,
Content-Disposition mit sanitisiertem Spielernamen, `PK\x03\x04`, die drei zusätzlichen
Archiveinträge) bleiben unverändert gültig und werden erstmals unbedingt geprüft. Den Test
`GET /api/agent-download derives the player from the session` auf denselben Stub setzen — er
braucht die reale Exe für seinen einen Statuscode ohnehin nicht.

**Weiterhin erkannte Regression:** vollständig — Sessionableitung, 401 für unbekannte Spieler,
ZIP-Erzeugung mit korrekten Headern und Dateinamen, 503 bei fehlender Exe. Die einzige Zusicherung,
die entfällt, ist „archiver kann eine 92-MB-Datei packen“, was eine Bibliothekseigenschaft ist und
kein Verhalten dieses Repositories.

**Risiko der Änderung:** gering. Der Stub existiert im selben File bereits als Vorlage; die
Umstellung ist auf eine Datei begrenzt.

---

#### P2-3 `eventWorkspaceSwitch.e2e.test.ts` verschläft rund 13,6 s pro Lauf

**Datei / Testgruppe:** `server/src/test/e2e/eventWorkspaceSwitch.e2e.test.ts:118` (`openView`),
`:161` (`before`), `:253` (Options-Schleife), `:396`. Core-Domäne `invitations`.

**Problem:** `openView()` endet unbedingt mit `await page.waitForTimeout(1_000)` — nach dem Klick,
ohne jede Bedingung. Der Helfer wird an zehn Stellen aufgerufen (`:171`, `:223`, `:446`, `:449`,
`:473`, `:484`, `:491`, `:513`, `:527`, `:571`). Dazu kommt eine weitere Sekunde am Ende von
`before()` und 400 ms je Eintrag der Event-Auswahl in der Schleife ab `:251`. Ausgeführtes Budget:
**≈ 13,6 s** reine Pausen in einem Prozess, dessen Partition insgesamt 59 s Wanduhrzeit braucht.

**Warum problematisch:** Direkter Verstoß gegen Regel 4, und zwar in der teuersten Form: eine
Pauschalwartezeit im meistgenutzten Navigationshelfer der Datei. Sie ist zugleich unsicher —
1000 ms sind eine Annahme über die Renderdauer, keine Zusicherung, und bei der unter P2-6
belegten Lastspreizung nicht garantiert.

**Überlappende Abdeckung:** entfällt — es geht um die Synchronisation, nicht um die Assertions.

**Empfohlene Maßnahme:** In `openView()` auf den beobachtbaren Zielzustand warten; die Datei
verwendet ihn bereits selbst an anderer Stelle:
`page.waitForSelector('#view-container[data-view="…"]')`, so wie
`eventInvitations.e2e.test.ts:144`. Für die Options-Schleife auf die jeweils
angewandte Auswahl warten (der sichtbare Wert von `#my-stats-event-search` oder das Ausbleiben
weiterer `/api/players/…`-Antworten). `:396` ist ein Negativfenster und gehört nicht hierher —
siehe Regelwerk-Lücke R-4.

**Weiterhin erkannte Regression:** alle bisherigen Assertions, zuverlässiger als heute, weil auf
Zustand statt auf Zeit gewartet wird.

**Risiko der Änderung:** gering. Fällt eine Wartebedingung falsch aus, wird das sofort und
reproduzierbar sichtbar, nicht sporadisch.

---

#### P2-4 Die Doppel-Browsertests von Blobby und Pong prüfen dieselben gemeinsamen Module

**Datei / Testgruppe:** `server/src/test/e2e/arcade.fixture.ts:809` („Blobby Doppel: mobile lobby
assigns two full teams and starts four players“, 13,4 s in CI) und `:858` („Pong Doppel: mobile and
desktop lobbies assign two full teams and start four players“, 11,6 s in CI).

**Problem:** Beide Tests öffnen vier Browserkontexte, schalten den Modus auf „doubles“, verteilen
zwei Teams, setzen viermal „bereit“, starten und prüfen vier `.arcade-player-tile`. Der Weg
dorthin läuft in beiden Fällen durch dieselben Module: `public/js/arcade/lobbyReady.js`
(`arcadeLobbyEntryHtml`, `arcadeLobbyModeButtonsHtml`, `readyToggleHtml`, `wireReadyToggle`) und
`public/js/arcade/arcadeUi.js` (`matchRosterHtml`). Spielspezifisch bleiben die Selektorpräfixe,
die Canvas-ID und beim Pong-Test ein Desktop-Viewport für den Host.

**Warum problematisch:** Regel 1 verlangt für jeden E2E-Test einen eigenen Integrationsnutzen. Der
zweite Doppel-Durchlauf liefert für die gemeinsamen Module keinen: ein Fehler in `lobbyReady.js`
lässt beide fallen. Zusammen 25 s der 108 s Wanduhrzeit der Arcade-Partition, bei acht gleichzeitig
laufenden Browserkontexten — die auch die unter P2-6 beschriebene Lastspreizung mitverursachen.

**Überlappende Abdeckung:** Der *serverseitige* Doppel-Vertrag ist **nicht** redundant:
`src/arcade/blobby.ts` und `src/arcade/pong.ts` sind eigenständige Implementierungen mit je eigenem
`playerLimit`, `doublesBots()`, `perTeam` und Ready-Gate. Die beiden Integrationstests
(`api.blobbyMultiplayer.test.ts`, `api.pongMultiplayer.test.ts`) bewachen deshalb je eine echte
Kopie und dürfen **nicht** zusammengelegt werden. Redundant ist nur die Browserhälfte. Zusätzlich
deckt `public/js/arcade/lobbyReady.test.js` die gemeinsame Markup-Erzeugung auf Unit-Ebene ab.

**Empfohlene Maßnahme:** Einen der beiden Doppel-Browsertests entfernen. Der Pong-Test ist der
stärkere Kandidat zum Behalten, weil er zusätzlich beide Viewports (Desktop-Host, mobile Gäste) in
einem Lauf abdeckt.

**Weiterhin erkannte Regression:** Der gemeinsame Lobby-/Ready-/Roster-Pfad im Browser bleibt durch
den verbleibenden Doppel-Test abgedeckt; der Blobby-spezifische Serververtrag durch
`api.blobbyMultiplayer.test.ts`; die Blobby-Browseroberfläche im Duellmodus durch „Arcade: joining
Pong or Blobby warns and closes the owned lobby first“ (`arcade.fixture.ts`).

**Risiko der Änderung:** mittel. Ein rein Blobby-spezifischer Verdrahtungsfehler im
*Doppel*-Modus des Browsers (etwa ein falsches `data-blobby-team`-Attribut) würde danach nicht mehr
im Browser auffallen. Wer dieses Restrisiko nicht tragen will, kürzt stattdessen beide Tests auf
den Teil, der nicht durch `lobbyReady.test.js` gedeckt ist — das spart weniger, verliert aber
nichts.

---

#### P2-5 Belegter Flake: „Scribble: live thumbs-up … next round starts blank“

**Datei / Testgruppe:** `server/src/test/e2e/arcade.fixture.ts:967`, Fehlerstelle `:1009-1011`
(kompiliert `dist-test/test/e2e/arcade.fixture.js:850`).

**Problem:** In Lauf 1544 lief das Warten auf `data-scribble-guess-result` nach
`requestSubmit()` des Rateformulars in den 30-Sekunden-Timeout (Testdauer 47,4 s); der gezielte
Retry derselben Datei lief in 12,7 s durch. Der Guess-Ack erreichte den Client also nicht.

**Warum problematisch:** Regel 5 — ein sporadisch fehlschlagender Test ist defekt. Der Test ist
zugleich mit 12,7 s (allein) bis 47,4 s (unter Last) einer der teuersten der Arcade-Partition.

**Überlappende Abdeckung:** `src/test/api.scribbleThumbsAndFavorites.test.ts` deckt die
Thumbs-up-Regeln und die Rejoin-Wiederherstellung auf Socketebene ab. Der Browsertest ergänzt das
Malen mit der echten Maus, die Kanvas-Pixelprüfung der neuen Runde und den Zuschauer-Thumb — echter
Integrationsnutzen, kein Redundanzfall.

**Empfohlene Maßnahme:** Erst prüfen, ob der Fehler bereits behoben ist, bevor daran gearbeitet
wird. PR #528 („Scribble: recover a guess ack lost to a reconnect“, `ef5e82c`) wurde am selben Tag
um 21:00 gemergt, also **nach** dem Fehlschlag um 19:18, und ändert genau
`public/js/arcade/views/arcadeScribble.js` und `src/arcade/scribble.ts` auf dem verlorenen
Guess-Ack. Das passt exakt auf das Fehlerbild. Wenn eine Nachbeobachtung über mehr Läufe keinen
weiteren Treffer zeigt, ist hier nichts zu tun.

**Weiterhin erkannte Regression:** unverändert.

**Risiko der Änderung:** entfällt, solange keine Änderung erfolgt.

**Unsicherheit:** ausdrücklich hoch. Dass #528 diesen Flake behebt, ist plausibel und zeitlich
stimmig, aber nicht bewiesen; seither gab es nur zwei grüne Arcade-Läufe — eine zu kleine
Stichprobe für einen Test, der einmal in zwölf Läufen fiel.

---

#### P2-6 30-Sekunden-Standardtimeouts treffen auf sechsfache Browser-Parallelität

**Datei / Testgruppe:** `server/scripts/run-e2e-partition.mjs:198` (`--test-concurrency=6`) im
Zusammenspiel mit dem impliziten Playwright-Standard von 30 s; explizite Timeouts sind über die
Suite verstreut (500 ms bis 10 s) und nirgends zentral gesetzt.

**Problem:** Aus demselben CI-Lauf (1544, identischer Commit, identischer Runner) lassen sich die
Laufzeiten unter voller Partitionslast direkt mit dem gezielten Einzel-Retry vergleichen:

| Test | in der vollen Partition | allein im Retry |
|---|---|---|
| „Scribble: expanded canvas keeps 8:5 …“ | 14,2 s | 4,7 s |
| „Scribble: live thumbs-up …“ | 47,4 s (Timeout) | 12,7 s |

Eine Spreizung von rund Faktor 3. Sechs parallele Node-Prozesse starten je einen eigenen Server und
einen eigenen Chromium, viele Tests darin öffnen zusätzlich drei bis vier Browserkontexte.

**Warum problematisch:** Zweifach. Erstens ist jede explizit gesetzte enge Grenze unter dieser
Spreizung eine Wette — die Navigationsklicks der Arcade-Fixtures liegen bei 4 s
(`arcade.fixture.ts:113`, `:116`, `:117`, `:126`, `:142`, `:143`, `:145`;
`challengeRush.fixture.ts:76`, `:78`, `:79`), und genau dort greifen die Retry-Schleifen aus
P1-1. Zweitens ist der 30-Sekunden-Standard für alles
Übrige zu großzügig, um zu diagnostizieren: beide belegten Flakes melden nur
`Timeout 30000ms exceeded`, obwohl derselbe Schritt allein in 1–8 s durchläuft. Die Fehlermeldung
trägt dadurch keine Information über die Abweichung.

**Überlappende Abdeckung:** entfällt.

**Empfohlene Maßnahme:** Zwei getrennte, kleine Schritte. (a) Einen bewussten
Standard-Erwartungswert setzen (`page.setDefaultTimeout(…)` in den Fixtures, deutlich über der
gemessenen Spitze, deutlich unter 30 s) und die verstreuten Einzelwerte daran ausrichten. (b) Die
Dateiparallelität an die tatsächlichen Runner-Kerne koppeln, statt sie fest auf sechs zu setzen —
der Kommentar an `run-e2e-partition.mjs:193` begründet die Sechs mit der Prozessanzahl, nicht mit
einer Messung. Beides bewusst **ohne** Timeouterhöhung; Regel 5 schließt größere Timeouts als
Flake-Antwort aus.

**Weiterhin erkannte Regression:** alle bisherigen Assertions; Fehlschläge melden ihre Abweichung
künftig früher und aussagekräftiger.

**Risiko der Änderung:** mittel. Ein zu knapper Standard erzeugt neue Fehlschläge; deshalb muss der
Wert aus den gemessenen Spitzen abgeleitet und nicht geraten werden. Eine reduzierte Parallelität
verlängert die Wanduhrzeit — die unter P2-1 und P2-4 gehobenen 56 s bzw. 25 s schaffen dafür
Spielraum.

---

#### P2-7 `flows.fixture.ts` prüft Layout und CSS in einer Dichte, die Refactorings blockiert

**Datei / Testgruppe:** `server/src/test/e2e/flows.fixture.ts` — 57× `getComputedStyle`, 51×
`getBoundingClientRect`, 15× `boundingBox`, 13× Scroll-Metriken. Härtester Einzelfall:
`:2549-2553` gegen `:2616-2620` und `:2674-2678`.

**Problem:** An `:2620` und `:2678` steht `assert.deepEqual(paidMarkerGeometry, openMarkerGeometry)`
auf `{ left, width }` aus `getBoundingClientRect()` — ein exakter Gleichheitsvergleich zweier
Fließkomma-Layoutwerte, gemessen vor und nach einem Re-Rendering. Daneben stehen reine
Strukturassertions wie `assert.deepEqual(rowOrder, ['description','amount','cluster','other'])`
(`:2533-2541`), `assert.deepEqual(groupActionOrder, ['copy','paypal','paid','remove'])`
(`:2556-2565`) und `getComputedStyle(input).textAlign === 'left'` (`:2510`).

**Warum problematisch:** Der Rect-Vergleich ist ein latenter Flake: jede Subpixelverschiebung —
später geladene Schrift, eine Scrollbar, ein anderes Device-Pixel-Ratio — lässt ihn fallen, ohne
dass sich fachlich etwas geändert hätte. Die Struktur- und CSS-Assertions kollidieren mit Regel 3:
„Ein Refactoring ohne Verhaltensänderung soll möglichst keine Teständerung erzwingen.“ Eine
Umbenennung einer CSS-Klasse oder ein zusätzlicher Wrapper im Markup bricht `rowOrder`, obwohl die
sichtbare Reihenfolge unverändert bleibt.

**Überlappende Abdeckung:** Der Designsystem-Anteil wird bereits deterministisch und ohne Browser
durch `server/scripts/check-design-tokens.js` und die Frontend-Unittests unter `public/js/` geprüft.

**Empfohlene Maßnahme:** Kein pauschaler Abbau — ein Teil dieser Assertions schützt Produktziel 3
und ist berechtigt. Gezielt sind drei Dinge zu ändern: (a) die beiden exakten Rect-Vergleiche auf
eine Toleranz umstellen, wie es der Test in `eventDatePoll.e2e.test.ts:333` bereits vormacht
(`Math.abs(...) <= 24`); (b) `rowOrder`/`groupActionOrder` über stabile `data-*`-Attribute statt
über CSS-Klassennamen bilden; (c) `textAlign`-Prüfungen dort weglassen, wo ein Token-Check dieselbe
Aussage trifft.

**Weiterhin erkannte Regression:** „Der Bezahlt-Marker springt beim Umschalten nicht“ und „die
Aktionsreihenfolge in der Positionszeile bleibt stabil“ bleiben geprüft — nur robuster gegen
Änderungen, die das Verhalten nicht betreffen.

**Risiko der Änderung:** gering. Eine zu großzügige Toleranz könnte eine echte Layoutverschiebung
durchlassen; der Wert ist deshalb aus der beabsichtigten Zusicherung abzuleiten („der Marker springt
nicht“), nicht aus dem gemessenen Rauschen.

---

### P3 — sinnvolle Vereinfachung mit niedrigem Risiko

---

#### P3-1 `phase5eIsolation.e2e.test.ts` ist kein Browsertest, liegt aber in der Browserpartition

**Datei / Testgruppe:** `server/src/test/e2e/phase5eIsolation.e2e.test.ts` (107 Zeilen, ein Test,
1,98 s in CI), Core-Domäne `flows`.

**Problem:** Die Datei startet keinen Browser. Sie verbindet zwei `socket.io-client`-Sockets gegen
den gebauten Server und prüft, dass ein nicht abonnierter Socket nichts empfängt. Sie synchronisiert
außerdem mit `await new Promise(resolve => setTimeout(resolve, 150))` (`:100`).

**Warum problematisch:** Zweierlei. Erstens definiert `TESTING.md` E2E als „startet den echten
gebauten Server **+ einen echten Chromium** und klickt durch die Web-UI“ — die Datei erfüllt das
nicht, steht aber im Manifest der Core-Partition und belegt dort einen der sechs parallelen
Prozessslots. Zweitens ist ihre Kernaussage (default-deny für unabonnierte Sockets) laut
`TESTING.md` selbst bereits Bestandteil von `src/test/realtime.delivery.required.test.ts`.

**Überlappende Abdeckung:** `realtime.delivery.required.test.ts` deckt die vollständige
Zustellmatrix inklusive default-deny ab — allerdings gegen eine im selben Prozess aufgebaute
Socket.IO-Instanz. `phase5eIsolation` prüft zusätzlich, dass der **gebaute** Server
(`dist/index.js`) den Guard tatsächlich registriert und dass die Cookie-Authentifizierung über eine
echte HTTP-/WS-Verbindung greift. Dieser Rest ist echt und sollte nicht verloren gehen.

**Empfohlene Maßnahme:** Zwei Optionen, beide klein. (a) Belassen, aber `TESTING.md` an die Realität
anpassen: die Datei als bewussten Boot-/Verdrahtungstest im E2E-Verzeichnis benennen und die
E2E-Definition entsprechend präzisieren. (b) Umziehen und die Definition unangetastet lassen —
dann aber nicht nach `src/test/*.test.ts`, weil `npm test` laut Dokumentation ohne Serverprozess
auskommen soll. Empfehlung: (a). In beiden Fällen `:100` durch das Warten auf den empfangenen
`live:changed`-Event mit knapper Frist ersetzen, statt 150 ms pauschal zu warten.

**Weiterhin erkannte Regression:** unverändert; die Zustellmatrix bleibt in
`realtime.delivery.required.test.ts`, die Verdrahtung des gebauten Servers in dieser Datei.

**Risiko der Änderung:** minimal (Dokumentationsangleichung) bis gering (Ersatz der Pauschalpause).

---

#### P3-2 `flows.fixture.ts` bündelt vier unabhängige Owner-Prozesse in 4 595 Zeilen

**Datei / Testgruppe:** `server/src/test/e2e/flows.fixture.ts` (4 595 Zeilen, 37 `flowTest`-Fälle),
eingebunden über vier zweizeilige Wrapper (`flowsShell`, `flowsCompetition`, `flowsCommunity`,
`foodOrders`).

**Problem:** Die Aufteilung in vier Owner-Prozesse ist dokumentiert und richtig — die
Zusammenfassung in *eine* Quelldatei ist davon unabhängig und macht die Datei zum größten
Wartungsposten der Suite: alle acht `waitForTimeout`-Stellen, 136 Layout-/CSS-Assertions und
sämtliche gemeinsamen Helfer liegen darin, und jede Änderung an einem Shard berührt die Datei
aller vier.

**Warum problematisch:** Regel 6 nennt „unnötig komplex“ ausdrücklich als Grund zur Vereinfachung.
Die Pfadklassifikation (`scripts/e2e-partitions.mjs:29`) ordnet `flows.fixture.ts` pauschal der
Domäne `flows` zu — eine Änderung, die nur die Food-Order-Tests betrifft, wählt damit dieselbe
Domäne wie eine, die nur die Shell betrifft. Feinere Auswahl ist mit einer Datei nicht möglich.

**Überlappende Abdeckung:** keine; es geht ausschließlich um die Dateistruktur.

**Empfohlene Maßnahme:** Die Datei entlang der bereits existierenden Shard-Grenzen in vier Fixtures
plus ein gemeinsames Helfermodul zerlegen und die vier Einträge in `E2E_SUPPORT_FILES.core`
entsprechend eintragen. Reine Umstrukturierung ohne Assertion-Änderung.

**Weiterhin erkannte Regression:** alle 37 Fälle unverändert, in denselben vier Prozessen.

**Risiko der Änderung:** gering, aber die Diffgröße ist erheblich; ein Fehler beim Verschieben fällt
sofort auf, weil das Manifest eine nicht zugeordnete Datei namentlich zum Fehlschlag bringt.
Sinnvoll als eigener PR, nicht nebenbei.

---

#### P3-3 `format.test.js` baut die Implementierung nach, statt ein Ergebnis zu prüfen

**Datei / Testgruppe:** `server/public/js/format.test.js:39-44`
(„formatSince falls back to a clock time past an hour“).

**Problem:**

```js
const ts = Date.now() - 90 * 60_000;
const d = new Date(ts);
const expected = `seit ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} Uhr`;
assert.equal(formatSince(ts), expected);
```

Die Erwartung ist Zeile für Zeile dieselbe Rechnung wie `format.js:22`.

**Warum problematisch:** Regel 3. Der Test kann per Konstruktion keinen Fehler in genau dieser
Rechnung finden — ein Wechsel von `getHours()` auf `getUTCHours()` würde Erwartung und Ergebnis
gleichermaßen verschieben und grün bleiben. Er erkennt nur noch, dass überhaupt der
Stundenzweig statt „gerade eben“ oder „seit N Min.“ gewählt wird, und das prüfen die beiden
Nachbartests (`:31-37`) bereits.

**Überlappende Abdeckung:** `:31-33` und `:35-37` decken die beiden anderen Zweige mit festen
Erwartungswerten ab; `toDatetimeLocal` wird an `:51-58` korrekt mit einem konstruierten Datum und
einem literalen Erwartungswert geprüft — das ist das Muster, das hier fehlt.

**Empfohlene Maßnahme:** Erwartung literal machen, analog zu `:51-58`: einen festen Zeitpunkt
konstruieren (`new Date(2026, 6, 8, 14, 30)`) und `'seit 14:30 Uhr'` erwarten. Damit prüft der Test
erstmals die Formatierung selbst. Die Zweigwahl bleibt unabhängig davon durch die Nachbartests
gedeckt.

**Weiterhin erkannte Regression:** die Zweigwahl (Nachbartests) plus, neu und erstmals wirksam, die
Stunden-/Minutenformatierung inklusive Nullauffüllung.

**Risiko der Änderung:** minimal, auf drei Zeilen begrenzt.

---

#### P3-4 `waitForAction` baut `waitFor` mit 280 Schleifendurchläufen nach

**Datei / Testgruppe:** `server/src/test/e2e/challengeRush.fixture.ts:234-241`, verwendet vom
Katalogdurchlauf ab `:358`. Zusätzlich die Klick-Taktung mit `waitForTimeout(80)` an `:246`, `:252`,
`:270` und `waitForTimeout(50)` an `:285`.

**Problem:** `waitForAction` pollt bis zu 280-mal mit je 25 ms Pause, ob ein Selektor existiert und
die Challenge noch läuft — also eine handgeschriebene Neuimplementierung von
`locator.waitFor({ timeout })`, kombiniert mit einer Abbruchbedingung. Die Klickschleifen takten
sich mit festen 80 ms, statt auf die Wirkung des vorigen Klicks zu warten.

**Warum problematisch:** Regel 4 (feste Pausen als Synchronisationshilfe) und Regel 6 (unnötige
Komplexität). Die Konstruktion ist zudem schwer zu lesen: die effektive Frist (280 × 25 ms ≈ 7 s)
steht nirgends als Zahl, sondern ergibt sich aus zwei Konstanten.

**Überlappende Abdeckung:** Das Protokoll hinter diesen Klicks ist auf Socketebene in
`src/test/api.challengeRush.test.ts` abgedeckt; der Browserteil prüft die Renderer-Verdrahtung —
kein Redundanzfall, nur ein Umsetzungsproblem.

**Empfohlene Maßnahme:** `waitForAction` durch ein `Promise.race` aus
`page.locator(selector).waitFor({ timeout })` und dem Ende-Zustand ersetzen, mit der Frist als
benannter Konstante. Die Klickschleifen auf einen beobachtbaren Fortschritt umstellen (die Stage
führt bereits `data-phase`, `data-challenge-index` und `data-remaining-ms`).

**Weiterhin erkannte Regression:** unverändert alle 31 Challenge-Renderer.

**Risiko der Änderung:** gering bis mittel. Findet man für eine Challenge-Art keinen sauberen
Fortschrittszustand, bleibt dort eine getaktete Schleife — dann aber begründet und benannt statt
pauschal.

---

#### P3-5 Der Katalogdurchlauf existiert zweimal, auf zwei Ebenen

**Datei / Testgruppe:** `src/test/api.challengeRush.test.ts:534` („plays through every Phase 3
mini-challenge and records a complete history“, **13,2 s** — der teuerste Einzeltest der
Unit-/Integrationssuite) und `src/test/e2e/challengeRush.fixture.ts:358` („plays every Phase 3
mini-challenge to a final summary in the browser“, **42,9 s** in CI).

**Problem:** Beide spielen den vollständigen Katalog aller 31 Challenges einmal durch. Der
Integrationstest schließt die meisten trialbasierten Challenges allerdings mit
`action: 'timeout'` ab (`:527-531`) — er prüft für diese also „lässt sich starten und beenden und
landet in der History“, nicht das Spielen selbst. Genau das beweist der Browsertest ebenfalls, weil
er alle 31 der Reihe nach bis zum Ergebnis führt.

**Warum problematisch:** Regel 2 — der zusätzliche Test braucht zusätzliche Fehlererkennung. Für
die trialbasierten Challenges liefert der Integrationsdurchlauf gegenüber dem Browserdurchlauf
wenig, kostet aber 6,5 % der Gesamtsuite.

**Überlappende Abdeckung:** wechselseitig, siehe oben. Eindeutig **nicht** überlappend sind die
gezielten Einzeltests über `startSelectedChallenge` (`:497-512`), die je eine konkrete Challenge
protokollnah prüfen — die bleiben unberührt.

**Empfohlene Maßnahme:** Vor jeder Änderung die Auswahl prüfen: `scripts/ci-path-classifier.mjs`
startet die volle Arcade-Partition nur bei direkten Arcade-Änderungen. Eine Änderung an
`src/db.ts` löst Core-E2E plus Arcade-Smoke aus, und der Browserdurchlauf läuft dann **nicht** — in
diesem Fall ist der Integrationsdurchlauf die einzige Katalogabsicherung. Deshalb lautet die
Empfehlung nicht „löschen“, sondern: die Assertion `history === CHALLENGES` behalten und den Weg
dorthin verkürzen (Deadline im Socket-Profil ist bereits auf 1 200 ms verkürzt; die verbleibende
Zeit steckt in den `sleep(35)`-Taktungen von `sendSequence`/`sendSteps`, `:465-488`, die auf den
30-ms-Input-Throttle des Servers warten).

**Weiterhin erkannte Regression:** „jede Challenge des Katalogs lässt sich starten, beenden und
wird in der History geführt“ bleibt auf Integrationsebene; „jeder Renderer ist im Browser
bedienbar“ bleibt im Browsertest.

**Risiko der Änderung:** gering.

**Unsicherheit:** Ob die 13,2 s tatsächlich überwiegend in den `sleep(35)`-Taktungen liegen, wurde
nicht einzeln gemessen — 31 Challenges à ~426 ms im Mittel passen dazu, beweisen es aber nicht.
Vor einer Optimierung ist der Anteil zu messen.

---

## 3. Lücken und Widersprüche im Regelwerk

PR #530 hat sechs verbindliche Regeln eingeführt und die widersprechenden Stellen in
`DEVELOPMENT_GUIDELINES.md`, `server/DEVELOPMENT_GUIDELINES.md`, `server/AGENTS.md`,
`docs/plans/auto-feature-to-deploy-pipeline.md` und
`.github/agent-pipeline/review-session-prompt.md` nachgezogen. Drei Stellen, die dieselben
Eigenschaften normieren, blieben stehen — dasselbe Muster wie die drei bereits im PR behobenen.

### R-1 (schwerwiegend) Der Review-Launcher fährt weiter die Regeln von vor #530

**Datei:** `scripts/agent-review-session.mjs:216-231` (`DEFAULT_FOCUS`), Prompt-Aufbau `:140-215`.

`AGENTS.md` schreibt fest: „Separate Reviews verwenden den Prompt und Ablauf unter
`.github/agent-pipeline/review-session-prompt.md`.“ Der Launcher liest diese Datei jedoch nicht — er
baut einen eigenen, parallelen Prompt. Und in diesem Prompt fehlt der gesamte durch #530 ergänzte
Teil:

- Punkt 8 aus `review-session-prompt.md:99-112` („Prüfe Teständerungen … in beide Richtungen. Mehr
  Tests, mehr Assertions oder höhere Coverage sind kein Qualitätsgewinn … Verlange zusätzliche Tests
  nicht allein deshalb, weil ein geänderter Zweig keine direkte Abdeckung hat“) kommt im
  generierten Prompt **überhaupt nicht** vor.
- Die Schweregradliste `:163-170` enthält die Einordnung aus `review-session-prompt.md:130-132`
  nicht („Testqualitäts-Findings nach Punkt 8 sind grundsätzlich `low`“).
- `DEFAULT_FOCUS:223-224` trägt weiterhin die schematische Formulierung, die #530 in
  `DEVELOPMENT_GUIDELINES.md` ausdrücklich ersetzt hat: „Testlücken: Happy Path, relevante
  Validierungsfehler und Zustandskonflikte **für jede geänderte Logik**“. Die Root-Richtlinie sagt
  seit #530 das Gegenteil: „risikobasiert abzudecken, **nicht schematisch je durch einen eigenen
  neuen Test**“.

Wirkung: Jedes automatisierte Separat-Review (`review:self`, `review:cross`) fordert weiterhin
schematisch Tests pro geändertem Pfad und kennt keine Obergrenze für Testqualitäts-Findings — genau
das Wachstum, das #530 stoppen sollte, wird durch die Automatisierung reproduziert.

**Empfehlung:** `DEFAULT_FOCUS` auf die risikobasierte Formulierung ziehen und Punkt 8 samt der
`low`-Voreinstellung in den generierten Prompt übernehmen. Besser noch: den Prompt aus
`review-session-prompt.md` lesen, statt ihn ein zweites Mal zu formulieren — sonst wiederholt sich
die Divergenz beim nächsten Regelupdate. Der bestehende Test
`scripts/agent-review-session.test.mjs` prüft den erzeugten Prompt bereits und ist die Stelle, an
der eine Regelübernahme abgesichert werden kann.

### R-2 Die drei Review-Modi wenden unterschiedliche Testregeln auf denselben Head-SHA an

**Dateien:** `.github/workflows/agent-pipeline-claude-review.yml:164` und
`.github/workflows/agent-pipeline-claude-self-review.yml:177`.

Beide Prompts normieren dieselbe Eigenschaft mit einem einzigen Wort — „relevante Testlücken“ —
ohne die zweigerichtete Prüfung aus Punkt 8 und ohne die `low`-Voreinstellung für
Testqualitäts-Findings. Ihre `severity`-Enums lassen `medium` und `high` für ein Testlücken-Finding
zu, und `medium` blockiert laut Pipeline bis zur Behebung.

Wirkung: Ob eine fehlende Testabdeckung einen PR blockiert, hängt davon ab, welchen Reviewmodus der
Nutzer für diesen Head-SHA gewählt hat. `AGENTS.md` stellt die drei Modi jedoch als gleichwertige
Alternativen dar.

**Empfehlung:** Die Formulierung aus `review-session-prompt.md:99-112` und `:130-132` in beide
Workflow-Prompts übernehmen, oder beide auf das gemeinsame Dokument verweisen lassen.

### R-3 Die Ausnahme aus Regel 4 wurde nicht in den Reviewprompt nachgezogen — die aus Regel 5 schon

**Dateien:** `server/TESTING.md:26-31` (Regel 4) gegen
`.github/agent-pipeline/review-session-prompt.md:102-107` (Punkt 8).

Regel 4 erlaubt ausdrücklich „das Verstreichenlassen einer echten, produktiv existierenden Frist,
die selbst Prüfgegenstand ist — etwa Countdown-, Reveal- und Deadline-Übergänge in den
Fast-Timer-Profilen“. Punkt 8 des Reviewprompts trägt die Anweisung „Melde insbesondere …
Pauschalwartezeiten, aufgeblähte Timeouts …“ **ohne** diese Ausnahme.

Dass es sich um ein Versehen und nicht um eine Absicht handelt, zeigt derselbe Satz: die *andere*
Ausnahme — die zustandsbehafteten E2E-Owner aus Regel 5 — ist dort sorgfältig ausgeschrieben
(„außerhalb der Ausnahme für die absichtlich zustandsbehafteten E2E-Owner in `server/TESTING.md`
(innerhalb eines Owner-Prozesses sind beide dort ausdrücklich zulässig)“). Von zwei Ausnahmen wurde
eine übernommen.

Wirkung: Ein regelkonformes Review muss die von `TESTING.md` erlaubten Wartestellen als Finding
melden. Der Autor muss dann gegen den Reviewprompt argumentieren, obwohl die verbindliche Regel auf
seiner Seite steht.

**Empfehlung:** Die Ausnahme in Punkt 8 in derselben Form ergänzen wie die aus Regel 5.

### R-4 (eigene Kategorie) Für Negativfenster gibt es keine Regel

Kein Nachzugsfehler, sondern eine echte Lücke. Um zu beweisen, dass etwas **nicht** passiert,
braucht ein Test ein begrenztes Beobachtungsfenster. Die Suite tut das an mindestens vier Stellen,
und drei davon benennen es im Kommentar:

| Stelle | Zweck |
|---|---|
| `src/test/e2e/arcade.fixture.ts:1038-1040` | „This is a negative assertion window: a stale reconnect replay must not paint after the freshly mounted round-two canvas has appeared.“ |
| `src/test/api.challengeRush.test.ts:689` | „a paused match must not advance the memorize phase“ |
| `src/test/api.challengeRush.test.ts:724` | „a finished match must not keep an armed preview timer“ |
| `src/test/e2e/eventWorkspaceSwitch.e2e.test.ts:396` | in Bearbeitung befindliche Eingabe überlebt einen Hintergrund-Refresh |
| `src/test/realtime.delivery.required.test.ts:137` | `settle()` vor Negativassertions auf nicht zugestellte Events |

Regel 4 kennt nur zwei Zustände: unzulässige Pauschalwartezeit oder erlaubte produktive Frist. Ein
Negativfenster ist beides nicht — es gibt keinen Zustand, auf den man warten könnte, denn der zu
prüfende Zustand ist gerade der, der ausbleiben soll. Formal sind damit fünf legitime,
unvermeidbare und gut begründete Stellen regelwidrig.

Zwei Nebenbefunde derselben Regel: die geforderte Kommentarpflicht („Solche Stellen benennen im
Kommentar die Frist, auf die gewartet wird“) ist ungleichmäßig erfüllt — etwa
`src/test/e2e/challengeRush.fixture.ts:187` (`waitForTimeout(1_000)`, um zu belegen, dass die
Restzeit im Pausenzustand nicht sinkt) trägt keinen Kommentar. Und die Regel erfasst nicht, dass
eine *absichtlich verzögerte Route* (`eventWorkspaceSwitch.e2e.test.ts:262`, `:352`) keine
Synchronisationshilfe, sondern ein Stimulus ist — hier ist die Regel korrekt, aber die Abgrenzung
steht nirgends, und beide Stellen mussten sie im Kommentar selbst herleiten.

**Empfehlung:** Regel 4 um einen dritten zulässigen Fall ergänzen: ein begrenztes Negativfenster,
wenn die Zusicherung das Ausbleiben eines Ereignisses ist, mit der Pflicht, im Kommentar zu
benennen, *was* nicht passieren darf und *warum* die gewählte Dauer ausreicht. Die Abgrenzung
gegenüber injizierter Latenz im Testaufbau in einem Halbsatz mitnehmen.

### R-5 Die E2E-Definition beschreibt nicht, was in der E2E-Partition liegt

`server/TESTING.md` definiert E2E in der Tabelle „Test-Arten“ als „Startet den echten gebauten
Server + einen echten Chromium und klickt durch die Web-UI“. `phase5eIsolation.e2e.test.ts` startet
keinen Chromium (siehe P3-1). Die Root-Richtlinie verlangt in Abschnitt 1, dass Dokumentation und
tatsächliches Verhalten im selben Arbeitspaket in Einklang gebracht werden.

**Empfehlung:** Zusammen mit P3-1 entscheiden und die Definition entsprechend präzisieren.

## 4. Geprüft, ohne Befund

Damit die Findings nicht als vollständige Mängelliste missverstanden werden — folgende ausdrücklich
gesuchte Klassen wurden untersucht und für in Ordnung befunden:

- **Mocks, die die Implementierung nachbauen:** keine gefunden. Gemockt wird ausschließlich an
  echten Grenzen — `pushTransport.send` über `t.mock.method` (`api.push.test.ts`) und eine
  Socket.IO-Attrappe in `liveStatus.sweepOnce.test.ts`. Beide ersetzen externe Zustellung, nicht
  Logik.
- **Ungeseedeter Zufall:** `Math.random()` kommt an sechs Stellen vor, ausnahmslos zur Erzeugung
  eindeutiger Namen (`api.challengeRush.test.ts:55`, `arcade.snakeArena.test.ts:177`,
  `challengeRush.fixture.ts:50`, `api.realtime.test.ts:368`, `agent/src/state.test.js:9`,
  `agent/src/config.test.js:9`). Kein Assertionsergebnis hängt daran.
- **Zeitzonenabhängigkeit:** keine gefunden. `format.test.js:39-44` leitet seine Erwartung aus
  demselben Zeitstempel ab und ist dadurch zonenneutral (was zugleich sein Problem ist, siehe P3-3).
- **Frontend- und Skript-Suiten:** 384 Tests in 2,2 s, ohne Pauschalwartezeiten und ohne
  Layout-Assertions. Das ist das Vorbild, nicht der Problemfall.
- **Die `*.required.test.ts`-Familie:** wirkt schematisch, ist es aber nicht. 221 Zeilen für einen
  Test bündeln eine Rollen-, 404- und Event-Isolationsmatrix, die die jeweiligen fachlichen Suiten
  nicht abdecken. Kein Redundanzbefund.
- **Der E2E-Retry in `deploy.yml`:** wie beauftragt nicht bewertet — er läuft als `if: failure()`
  mit `continue-on-error: true` und macht keinen roten Lauf grün.

## 5. Restrisiken und Grenzen dieser Analyse

- Die lokale Messung lief auf **Node 22**, nicht auf dem festgelegten Node 24, weil in dieser
  Umgebung keine 24er-Laufzeit verfügbar war. Die Verhältniszahlen sind belastbar (alle Vergleiche
  auf derselben Laufzeit), die Absolutwerte können auf CI leicht abweichen. Die
  CI-Schrittlaufzeiten in Abschnitt 1 stammen dagegen direkt aus GitHub Actions.
- Die Browser-E2E-Suiten wurden **nicht** lokal ausgeführt (kein Chromium-Setup ohne Dateiänderung
  im Zeitrahmen). Alle E2E-Laufzeiten stammen aus CI-Logs.
- Die Flake-Auswertung beruht auf zwölf `main`-Läufen. Für Aussagen über die Häufigkeit einzelner
  Flakes ist das eine kleine Stichprobe; die *Existenz* der beiden Flakes ist durch Log und
  Retry-Ergebnis belegt.
- P1-3 und P2-5 nennen Ursachenhypothesen, keine Feststellungen; die Unsicherheit ist dort jeweils
  ausgewiesen.
- Nicht systematisch untersucht wurden: `db.migrations.test.ts` (19,4 s, 46 Tests, jeder mit
  eigenem Kindprozess) auf inhaltliche Redundanz zwischen den Migrationsfixtures, sowie die
  Agent-Suiten unter `agent/`. Beide waren im Vergleich unauffällig, aber die Migrationsdatei ist
  mit 3 264 Zeilen die größte der Suite und ein plausibler Kandidat für eine eigene, gezielte
  Durchsicht.
- Zwei fest eingetragene Zukunftsdaten wurden geprüft und als unkritisch eingestuft:
  `flows.fixture.ts:755`/`:774` (`15062027`, `08072027` — die geprüfte Regel ist die
  Bereichsregel zwischen Start und Ende, nicht „liegt in der Zukunft“) und `:2486`/`:2501`
  (`2026-12-24T20:00`, gegen `MIN_SEND_AT = Date.UTC(2000, 0, 1)` in
  `src/routes/foodOrders.ts:66` dauerhaft gültig; die Assertion prüft `24.12. 20:00 Uhr` ohne
  Jahresanteil). Sie sind keine Zeitbomben derselben Klasse wie der behobene Kalendertagsfehler,
  bleiben aber datumsgekoppelte Literale.
