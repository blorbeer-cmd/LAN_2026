# Codebase-Audit: Aktualität, Aufräumpotenzial und Refactoring

Stand: 2026-08-08

Geprüfte Basis: `origin/main` auf `6323a83` (PR #365)

Audit-Branch: `codex/codebase-audit-2026-08`

## Kurzurteil

Die Codebasis ist technisch gesund: Build, Linting, Formatprüfung, Unit-/Integrations- und
Browser-E2E-Tests sind grün. Alle untersuchten Produktionsdateien sind aus einem Einstiegspunkt
statisch erreichbar. Es gibt deshalb derzeit keinen belastbaren Grund, ganze Server-, Frontend-
oder Agent-Dateien zu löschen.

Der dringendste Handlungsbedarf ist kleiner und konkreter:

1. Vier bekannte Schwachstellen in den **Server-Laufzeitabhängigkeiten** beheben.
2. Zwei nicht definierte CSS-Tokens korrigieren; derzeit werden betroffene Deklarationen vom
   Browser verworfen.
3. Veraltete Konzeptstände als umgesetzt, teilweise umgesetzt oder noch nicht umgesetzt
   kennzeichnen, damit historische Ist-Zustände nicht mehr wie aktuelle Architektur wirken.
4. 16 ungenutzte TypeScript-/JavaScript-Symbole bereinigen und danach eine automatische
   Schutzregel aktivieren.
5. Klar verwaiste CSS-Blöcke entfernen und die sehr große zentrale Stylesheet-Datei anschließend
   vorsichtig nach Fachbereichen aufteilen.

Große strukturelle Umbauten sind dagegen nicht angezeigt. Insbesondere ist die Größe von
`server/src/db.ts` überwiegend durch bewusst aufbewahrte Schema- und Migrationshistorie begründet.

## Umsetzungsstand auf dem Audit-Branch

Paket 1 wurde nach der Bestandsaufnahme auf diesem Branch umgesetzt:

- die vier Server-Funde wurden innerhalb der vorhandenen Major-Versionen aufgelöst
  (`nanoid 3.3.18`, `socket.io-parser 4.2.7`, `body-parser 1.20.6`,
  `brace-expansion 2.1.4`); `npm audit` meldet danach auch inklusive
  Entwicklungsabhängigkeiten keine bekannte Schwachstelle;
- die drei Verwendungen von `--radius-md` nutzen jetzt den dokumentierten Token `--radius`;
- `--motion-fast` ist definiert und im Designsystem dokumentiert;
- der Token-Checker prüft den vollständigen aktuellen Frontend-Bestand auf undefinierte
  CSS-Custom-Properties und besitzt Regressionstests für Definitionen, dynamische Zuweisungen,
  Fallbacks und echte Fehler;
- ein unter Last sichtbar gewordener Challenge-Rush-Test serialisiert unabhängige
  Spielerantworten nicht mehr künstlich und prüft jeden Socket-Ack explizit.

Die vollständige Verifikation dieses Umsetzungsstands ist grün: reproduzierbare Neuinstallation,
Audit, Backup-Verifikation, Lint, Build, Formatprüfung, 965 Server-Tests, 165 Frontend-/Skript-Tests
und 71 Browser-E2E-Tests.

## Prüfumfang und Aussagegrenzen

Geprüft wurden der Express-/Socket.IO-Server, das statische Browser-Frontend, der Windows-Agent,
Tests, Paketstände, Repository-Skripte sowie die wesentlichen Konzept-, Plan- und Betriebsdokumente.

„Wird genutzt“ bedeutet in diesem Audit:

- **statisch erreichbar:** Eine Produktionsdatei ist über Imports oder statische HTML-Einstiege
  erreichbar;
- **getestet:** Verhalten wird durch Unit-, Integrations- oder E2E-Tests ausgeführt;
- **betrieblich genutzt:** Dafür wären reale Logs, Datenbankinhalte oder Produkt-Telemetrie nötig.

Die dritte Ebene wurde nicht untersucht. Selten verwendete Admin-, Backup-, Kompatibilitäts- oder
Notfallpfade dürfen daher nicht allein wegen geringer Testabdeckung entfernt werden. Dynamisch
gebildete CSS-Klassen wurden gesondert berücksichtigt; ein reiner Texttreffer-Scan reicht dort
nicht als Löschbeleg.

## Technische Ausgangslage

| Prüfung | Ergebnis |
|---|---|
| Gemeinsamer Preflight (`root`) | grün |
| Server: Lint, Build, Format | grün |
| Server: Unit-/Integrationstests | grün |
| Server: Coverage-Lauf | 965 Tests, 0 Fehler; 92,51 % Zeilen, 79,73 % Branches, 92,35 % Funktionen |
| Server: Playwright-E2E | 71 Tests, 0 Fehler |
| Agent: Lint und Unit-Tests | grün; 65 Tests, davon 5 plattformspezifisch übersprungen |
| Agent: echtes Server-Agent-E2E | 2 Tests, 0 Fehler |
| Relative Links in Markdown | 453 Dateien geprüft, 0 fehlende Ziele |
| `TODO`/`FIXME`/`HACK`/`XXX` | keine belastbaren offenen Marker |

Der statische Importgraph ergab:

| Bereich | Produktionsdateien | Vom Einstieg erreichbar | Nicht erreichbar |
|---|---:|---:|---:|
| Server-TypeScript | 111 | 111 | 0 |
| Frontend-JavaScript | 77 | 77 | 0 |
| Agent-JavaScript | 10 | 10 | 0 |

Das beweist keine reale Nutzung jeder Funktion, schließt aber die einfachste Form von „toten
Dateien“ aus. Auch die Produktionsskripte unter `server/scripts/` und `scripts/` sind über
Paket-Skripte, Workflows oder Betriebsdokumentation angebunden.

## Priorisierte Befunde

| Priorität | Befund | Empfohlene Maßnahme |
|---|---|---|
| P1 | Vier bekannte Schwachstellen in Server-Produktionsabhängigkeiten | Kleiner, fokussierter Dependency-PR mit vollständiger Verifikation |
| P2 | Nicht definierte CSS-Tokens `--radius-md` und `--motion-fast` | Auf vorhandene Tokens abbilden oder bewusst definieren; Checker ergänzen |
| P2 | Mehrere Konzepte enthalten historische Ist-Zustände ohne eindeutigen Status | Statuskopf und Verweis auf heutigen Endstand ergänzen |
| P2 | Projekthistorie endet bei PR #352, aktuelle Basis ist PR #365 | Changelog #353–#365 nachziehen und Basis aktualisieren |
| P2 | 16 ungenutzte Symbole, automatische Regel deaktiviert | Bereinigen, danach TypeScript-/ESLint-Schutz einschalten |
| P2 | Backup-/Push-/Readiness-HTTP-Pfade haben vergleichsweise geringe Coverage | Gezielte Fehlerpfadtests ergänzen |
| P3 | Mehrere CSS-Blöcke sind mit hoher Sicherheit verwaist | In kleinem UI-PR entfernen und visuell/E2E prüfen |
| P3 | `style.css` ist Größen- und Änderungs-Hotspot | Fachbereichsweise extrahieren, ohne Framework- oder Bundlerwechsel |

### P1 – Server-Laufzeitabhängigkeiten

`npm audit --omit=dev` meldet vier bekannte Probleme in tatsächlich ausgelieferten
Abhängigkeiten:

| Paket/Pfad | Schwere | Einordnung |
|---|---|---|
| `nanoid@3.3.15` | hoch | Direkte Abhängigkeit; Patch ist verfügbar |
| `socket.io-parser@4.2.6` über `socket.io` | hoch | Speichererschöpfung bei präparierten Paketen; für einen langlebigen LAN-Server relevant |
| `brace-expansion@2.1.1` über `archiver` | hoch | DoS-Pfad in der produktiven Archiv-/Backup-Kette |
| `body-parser@1.20.5` über Express 4 | niedrig | Patch über eine kompatible Express-/Abhängigkeitsaktualisierung verfügbar |

Empfehlung: keine blinde Kombination aus `npm audit fix`, Major-Upgrades und Refactoring. Zuerst
kompatible Patch-/Minor-Versionen in einem eigenen PR aktualisieren, dann Lint, Build, vollständige
Server-Tests, Backup-Verifikation und E2E erneut ausführen. Major-Sprünge wie Express 5,
`better-sqlite3` 13 oder TypeScript 7 gehören jeweils in getrennte Vorhaben.

Der Agent hat in Produktionsabhängigkeiten keine bekannte Schwachstelle. Seine drei vollständigen
Audit-Funde liegen in Entwicklungs-/Packaging-Werkzeugen; `@yao-pkg/pkg` kann separat von 6.21 auf
6.22 aktualisiert werden.

### P2 – CSS-Token-Drift mit sichtbarer Wirkung

In [`server/public/css/style.css`](../../server/public/css/style.css) werden zwei Variablen
verwendet, die weder dort noch im Designsystem definiert sind:

- `--radius-md` an drei Stellen, darunter aktive Notice- und Music-Pairing-Komponenten;
- `--motion-fast` für die Transition im Challenge-Rush-Odd-One-Out-Spiel.

Eine CSS-Deklaration mit einer nicht definierten Variable und ohne Fallback ist ungültig. Das führt
hier je nach Stelle zu fehlendem Radius beziehungsweise fehlender Transition. `--slider-pct` ist
dagegen kein Fehler: Es besitzt einen Fallback und wird dynamisch per JavaScript gesetzt.

Empfehlung: `--radius-md` wahrscheinlich durch das vorhandene `--radius` ersetzen und für
`--motion-fast` einen vorhandenen Bewegungswert verwenden oder einen dokumentierten Token
einführen. Der bestehende Design-Token-Check sollte zusätzlich unbekannte `var(--...)`-Referenzen
erkennen.

### P2 – Ungenutzte Symbole und fehlende Schutzregel

Die regulären ESLint-/TypeScript-Einstellungen melden ungenutzte Symbole aktuell nicht. Ein
einmaliger strenger Lauf fand sieben TypeScript- und neun Frontend-JavaScript-Funde; im Agent gab es
keinen Fund.

Server:

- ungenutzte Imports in `musicController.ts`, `routes/groups.ts`, `routes/music.ts` und
  `routes/players.ts`;
- eine ungenutzte lokale Variable in `arcade/arcade.ts`;
- das ungenutzte Interface `ItemRow` in `routes/foodOrders.ts`;
- ein ungenutzter Handler-Parameter in `musicController.ts`.

Frontend:

- ungenutzte Imports in `challengeRush.js`, `games.js` und `tournament.js`;
- ungenutzte Variablen oder Parameter in `arcadeScribble.js`, `challengeRush.js`,
  `matchmaking.js`, `tetris.js` und `tournament.js`.

Empfehlung: diese Funde mechanisch und verhaltensneutral entfernen beziehungsweise absichtlich
unbenutzte Schnittstellenparameter mit `_` kennzeichnen. Erst danach `noUnusedLocals` und eine
passend konfigurierte `no-unused-vars`-Regel aktivieren. `noUnusedParameters` sollte nicht
ungeprüft global aktiviert werden, da Framework-Signaturen absichtlich Parameter vorgeben können.

### P2/P3 – Testlücken nach Risiko statt Prozentzahl schließen

Die Gesamt-Coverage ist gut. Auffällig niedriger sind unter anderem:

- `routes/backup.ts`: 57,14 % Zeilen;
- `routes/groups.ts`: 59,65 % Zeilen;
- der zentrale Quiz-/Arcade-Handler `arcade/arcade.ts`: 61,30 % Zeilen;
- `routes/push.ts`: 74,04 % Zeilen;
- Readiness-Logik: 83,15 % Zeilen und 56,25 % Branches.

Die Gruppenrouten sind nach dem Ein-Gruppen-Reset bewusst als Kompatibilitätsoberfläche erhalten
und deshalb **kein Löschkandidat**. Den größten Zusatznutzen liefern Tests für Fehler- und
Wiederanlaufpfade bei Backup, Push und Readiness. Arcade-Verhalten ist bereits stark über E2E
abgedeckt; dort sollte nicht nur wegen einer lokalen Prozentzahl künstlich getestet werden.

### P3 – Verwaiste CSS-Kandidaten

Nach Abgleich mit HTML, JavaScript und Server-Ausgaben haben folgende Blöcke eine hohe
Wahrscheinlichkeit, Überbleibsel früherer Oberflächen zu sein:

- `.github-icon-btn`;
- `.group-switcher` nach Entfernung der Mehrgruppen-Oberfläche;
- `.checklist-assignment-toolbar`, deren Aufgabe heute `.selection-toolbar` übernimmt;
- `.challenge-rush-tile.is-odd`; der aktuelle Modus nutzt eine dynamische `nth-child`-Regel und
  ein Test sichert ausdrücklich ab, dass `.is-odd` nicht gesetzt wird;
- `.invite-link-row`, `.invite-qr-modal` und `.invite-qr-backdrop`;
- alte OAuth-/Musik-Selektoren wie `.oauth-callback-page`, `.oauth-callback-card`,
  `.music-connect-card`, `.music-config-list` und `.music-copy-row`.

Nicht pauschal löschen: Klassen wie `.badge-online`, `.is-playing`, `.is-paused`, `.is-online` und
`seating-side-*` werden dynamisch erzeugt und sind aktiv. Bei den Musikregeln teilen sich aktive und
verwaiste Selektoren teilweise dieselbe Regel; dort müssen nur die toten Selektor-Arme entfernt
werden. Ein kleiner separater PR mit Browser-Screenshots und E2E ist sicherer als eine große
„CSS-Bereinigung“.

## Refactoring-Hotspots

Änderungshäufigkeit und Dateigröße zeigen, wo Konflikte und Regressionen am ehesten entstehen:

| Datei | Größe | Änderungen in der Git-Historie | Urteil |
|---|---:|---:|---|
| `server/public/css/style.css` | 5.952 Zeilen | 233 Commits | Klarer Extraktionskandidat |
| `server/src/db.ts` | 3.581 Zeilen | 88 Commits | Groß, aber durch Schema/Migrationen bewusst zentral |
| `server/public/js/views/tournament.js` | 1.261 Zeilen | 62 Commits | Nur reine Render-/State-Helfer schrittweise extrahieren |
| `server/src/arcade/scribble.ts` | 1.214 Zeilen | 30 Commits | Domänengrenzen nutzen, keine pauschale Zerlegung |
| `server/public/js/views/arcadeScribble.js` | 1.108 Zeilen | 35 Commits | Zeichenfläche, Lobby und Galerie sind mögliche Grenzen |
| `server/src/routes/tournaments.ts` | 948 Zeilen | 20 Commits | Validierung/Queries nur bei konkretem Änderungsdruck trennen |

Für `style.css` ist eine schrittweise Aufteilung sinnvoll: Tokens und globale Basis bleiben in der
zentralen Datei; klar abgegrenzte Feature-Blöcke wie Battleship, Scribble, Tetris, Blobby oder Music
werden in statisch geladene Stylesheets verschoben. Das funktioniert mit der bestehenden
frameworklosen Architektur und braucht keinen Bundlerwechsel. Lade-Reihenfolge, responsive Regeln
und visuelle E2E-Abnahme sind dabei Teil der Änderung.

`db.ts` sollte nicht allein wegen der Zeilenzahl zerlegt werden. Es enthält das initiale Schema und
61 registrierte historische Migrationen, deren Reihenfolge und Wiederanlaufverhalten getestet sind.
Eine spätere rein strukturelle Teilung wäre nur sinnvoll, wenn `db.ts` der eindeutige Orchestrator
und die verbindliche Schemaquelle bleibt. Aktuell erzeugt sie mehr Risiko als Wartungsgewinn.

Auch kleine Duplikate sind nicht automatisch schlechte Abstraktionen: Die drei sehr kurzen
`emitWithAck`-Helfer in Arcade-Views rechtfertigen allein noch keine gemeinsame Schicht. Neue
Generalisierungen sollten erst entstehen, wenn sich tatsächlich gemeinsames Verhalten ändert.

## Aktualität der Konzepte und Pläne

| Dokument | Verifizierter Status | Empfohlene Pflege |
|---|---|---|
| [`KONZEPT-PACKLISTE-TICKETS.md`](../KONZEPT-PACKLISTE-TICKETS.md) | umgesetzt und passend gekennzeichnet | behalten |
| [`SCRIBBLE-ARCADE-ANALYSE.md`](../SCRIBBLE-ARCADE-ANALYSE.md) | umgesetzt, einschließlich Galerie | als historische Analyse behalten |
| [`reset-single-group.md`](../plans/reset-single-group.md) | abgeschlossen; wichtige Architekturentscheidung „Stilllegen statt Rückbau“ | behalten, nicht als offenen Plan lesen |
| [`user-management-status.md`](../plans/user-management-status.md) | bereits als historisch/überholt eingeordnet | behalten |
| [`feedback-general-ui-polish.md`](../plans/feedback-general-ui-polish.md) | ausdrücklich historischer, nicht verbindlicher Plan | bis zur Nutzerabnahme behalten, danach archivieren erwägen |
| [`auto-feature-to-deploy-pipeline.md`](../plans/auto-feature-to-deploy-pipeline.md) | aktives Zielkonzept, Phasen 0–2 umgesetzt | weiter als aktuelle Quelle pflegen |
| [`review-mode-selection.md`](../plans/review-mode-selection.md) | umgesetzt und aktuell gekennzeichnet | behalten |
| [`CURVE-FEVER-ARCADE-KONZEPT.md`](../CURVE-FEVER-ARCADE-KONZEPT.md) | im Produktionscode nicht umgesetzt | deutlich als Vorschlag/Backlog markieren; nicht löschen |
| [`KONZEPT-ARCADE-MEHRSPIELER.md`](../KONZEPT-ARCADE-MEHRSPIELER.md) | historisches Konzept, inzwischen mit wesentlichen Abweichungen umgesetzt | Status „umgesetzt/abgelöst“ und heutige Modi ergänzen |
| [`SCHIFFE-VERSENKEN-ARCADE-KONZEPT.md`](../SCHIFFE-VERSENKEN-ARCADE-KONZEPT.md) | Duell und KI umgesetzt; Teamgefecht offen; Kopf „Etappe 1 begonnen“ ist veraltet | umgesetzten Umfang und offenen/verworfenen Teammodus trennen |
| [`KONZEPT-TEST-USER.md`](../KONZEPT-TEST-USER.md) | umgesetzt; Branch- und Ist-Zustand wirken noch aktuell | Status „umgesetzt“ plus Verweis auf aktuelle Tests ergänzen |
| [`VORSCHLAG-SPIELE-REORGANISATION.md`](../VORSCHLAG-SPIELE-REORGANISATION.md) | größtenteils umgesetzt, aber anders als vorgeschlagen | als historischen Vorschlag mit Abweichungen kennzeichnen |
| [`KONZEPT-USER-MANAGEMENT.md`](../KONZEPT-USER-MANAGEMENT.md) | Architektur umgesetzt und weiterhin maßgeblich; Backlog teilweise überholt | Status aktualisieren; Event-Einladungen als erledigt markieren |
| [`FEEDBACK-GENERELL.md`](../FEEDBACK-GENERELL.md) | aktive Umsetzungs-/Nutzerabnahme-Liste | nicht archivieren; offene Auth-/Spieler-Punkte gegen heutigen Stand neu triagieren |
| [`issue-29-db-migrations.md`](../plans/issue-29-db-migrations.md) | vollständig umgesetzt, aber ohne Statuskopf | „umgesetzt/historisch“ ergänzen und auf Tests/`db.ts` verweisen |
| [`auto-resume-after-token-reset.md`](../plans/auto-resume-after-token-reset.md) | optionales externes Windows-Runbook; nicht durch dieses Repository provisioniert | Status und „zuletzt verifiziert“ ergänzen; Claude-Teil separat prüfen |

Wesentliche Abweichungen im Detail:

- Das Mehrspieler-Konzept beschreibt noch Zwei-Spieler-Grenzen und empfiehlt Tetris Sprint. Heute
  existieren unter anderem Snake Arena für 3–8, Tetris Arena/Battle für 3–8 sowie Pong- und
  Blobby-Doppel.
- Das Battleship-Konzept führt KI unter „später“ und Etappe 1 als begonnen. Die E2E-Suite deckt
  inzwischen Duell, manuelle Platzierung, Disconnects und Admin-KI ab; nur der Teammodus ist nicht
  umgesetzt.
- Beim Spiele-Hub wurde `game_catalog` wie geplant in `games` überführt, die Datei
  `views/gameCatalog.js` blieb jedoch als Teil der vereinheitlichten Ansicht erhalten. Der frühere
  „Jetzt zocken“-Ping wurde inzwischen entfernt.
- Im User-Management ist die als offene Idee geführte Annahme/Ablehnung von Event-Einladungen
  bereits implementiert und mit Zwei-Client-E2E abgedeckt.
- Die Codex-Hälfte des Auto-Resume-Runbooks entspricht weiterhin der
  [offiziellen Codex-CLI-Referenz](https://learn.chatgpt.com/docs/developer-commands?surface=cli):
  `codex exec resume`, `--last`, ein optionaler Folgeprompt und `workspace-write` sind dokumentiert.
  Daraus folgt nicht, dass die lokale Windows-Aufgabe eingerichtet ist; der Claude-Teil wurde in
  diesem Audit nicht extern verifiziert.

Zusätzlich ist [`docs/changelog/README.md`](../changelog/README.md) ausdrücklich nur bis PR #352
vollständig. Die geprüfte Basis enthält inzwischen PR #365. Die Einträge #353–#365 sollten als
eigener Dokumentationsauftrag nachgezogen werden, statt bei künftigen Audits eine falsche
Vollständigkeit anzunehmen.

## Empfohlene Reihenfolge

### Paket 1 – Sicherheit und kleine Korrekturen

1. Server-Abhängigkeiten kompatibel patchen.
2. CSS-Tokens reparieren und einen Undefined-Token-Check ergänzen.
3. Vollständige Server-, Backup- und E2E-Verifikation ausführen.

### Paket 2 – Mechanische Hygiene

1. 16 ungenutzte Symbole bereinigen.
2. Schutzregeln in TypeScript/ESLint aktivieren.
3. Verwaiste CSS-Blöcke separat entfernen.
4. Gezielt Tests für Backup-, Push- und Readiness-Fehlerpfade ergänzen.

### Paket 3 – Dokumentationswahrheit

1. Statusköpfe der Konzeptdokumente aktualisieren; Inhalte nicht vorschnell löschen.
2. `FEEDBACK-GENERELL.md` gegen den aktuellen Auth-/Spielerstand neu triagieren.
3. Changelog #353–#365 nachziehen.

### Paket 4 – Strukturelles Refactoring

1. `style.css` in kleine, fachlich getrennte Extraktions-PRs zerlegen.
2. Große Arcade-/Turnierdateien nur bei konkreten Folgeänderungen entlang testbarer Grenzen
   verkleinern.
3. `db.ts` vorerst bewusst unverändert lassen.

Diese Reihenfolge hält Sicherheits- und Korrektheitsarbeit klein und reviewbar. Sie verhindert
außerdem, dass Dependency-Updates, tote-code-Bereinigung und größere Dateiumbauten dieselben Fehler
gleichzeitig schwer lokalisierbar machen.

## Definition of Done für die Aufräumphase

- `npm audit --omit=dev` meldet für den Server keine bekannte Laufzeitschwachstelle mehr oder jede
  verbleibende Ausnahme ist mit Risiko und Ablaufdatum dokumentiert.
- Alle CSS-Custom-Properties sind definiert oder besitzen einen bewussten Fallback.
- Reguläre Lint-/Build-Läufe verhindern neue ungenutzte Imports und Variablen.
- Jedes Konzept trägt einen klaren Status: aktuell, umgesetzt/historisch, teilweise umgesetzt oder
  nicht umgesetzt.
- Die vollständige vorhandene Testmatrix bleibt grün.
- Keine Kompatibilitätsroute, Migration oder dynamische CSS-Klasse wird ohne konkreten
  Erreichbarkeits- und Verhaltensbeleg entfernt.
