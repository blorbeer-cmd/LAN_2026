# Gemeinsame Entwicklungsrichtlinien

Diese Datei enthält nur Regeln, die für praktisch jeden Auftrag im Repository gelten. Details
werden über die nächstgelegenen `AGENTS.md`-Dateien bereichsbezogen geladen:

- `server/AGENTS.md`: Server, API, Datenbank, Realtime, Tests und Betrieb
- `server/public/AGENTS.md`: Frontend und Designsystem
- `agent/AGENTS.md`: Windows-Agent und lokales Kontroll-Tool
- `docs/changelog/AGENTS.md`: Pflege der Projekthistorie

So bleibt der Standardkontext klein. Bereichsdokumente nur lesen, wenn der Auftrag den jeweiligen
Bereich tatsächlich betrifft.

## 1. Arbeitsweise

- Diese Datei vor Analyse, Planung oder Änderung vollständig lesen.
- Quellcode und Schema sind für aktuelle Implementierungsdetails maßgeblich. Bei Abweichungen das
  tatsächliche Verhalten prüfen und Dokumentation und Implementierung im selben Arbeitspaket
  wieder in Einklang bringen.
- Keine fachfremden Dokumente vorsorglich vollständig laden. Zuerst anhand des Auftrags und der
  betroffenen Pfade die einschlägigen Bereichsrichtlinien bestimmen.
- Nutzer- und Systemanweisungen haben Vorrang, danach die nächstgelegene `AGENTS.md` und diese Datei.
  Widersprüche zwischen Einstiegspunkten nicht stillschweigend auslegen, sondern melden oder im
  Rahmen eines passenden Dokumentationsauftrags beheben.

## 2. Session-Hygiene

Vor der Bearbeitung eines neuen Nutzerauftrags still prüfen, ob der aktuelle Arbeitskontext noch
passt:

- Eine neue Codex-Session beginnt standardmäßig mit einem neuen aufgabenspezifischen Branch und
  einem eigenen Worktree. Die Session darf nur dann auf einem bestehenden Branch oder PR starten,
  wenn der Nutzer dies zu Beginn ausdrücklich sagt und den bestehenden Kontext benennt.
- Diese Ausnahme gilt für die gesamte Session und nicht rückwirkend für bereits begonnene Arbeit.
  Fehlt die ausdrückliche Ansage, ist ein neuer Branch vom aktuellen `origin/main` anzulegen.
- Vor einer möglichen Wiederverwendung eines bestehenden Branches prüft Codex mindestens: Bezug
  zur gleichen Aufgabe oder zum gleichen PR, offenen und nicht bereits gemergten PR-Status,
  thematisch passende Arbeitsbaum- und Commit-Änderungen, Aktualität gegenüber `origin/main` sowie
  parallele Nutzung durch andere Sessions oder Worktrees.
- Nur wenn diese Prüfung eindeutig für eine Wiederverwendung spricht, darf der bestehende Branch
  übernommen werden. Bei gemischten Änderungen, unklarem Eigentum oder widersprüchlichem Kontext
  wird ein neuer Branch angelegt; hätte die Entscheidung Auswirkungen auf einen bestehenden PR,
  wird vor dem Start nachgefragt.
- Bei derselben Aufgabe, Phase, demselben PR und Branch in der aktuellen Session fortfahren.
- Jeder neue Änderungsauftrag, jede neue Phase und jeder neue PR erhält einen eigenen Branch und
  einen eigenen Worktree. Einen vorhandenen Worktree nur weiterverwenden, wenn er nachweislich
  derselben Aufgabe und demselben PR gehört.
- Einen Branch, dessen PR bereits gemergt wurde, niemals für Folgearbeiten weiterverwenden. Die
  Folgearbeit beginnt auf einem neuen Branch vom aktuellen `origin/main`, auch wenn GitHub für den
  alten Branch automatisch einen weiteren PR anbietet.
- `main` dient als saubere Integrationsbasis und darf nur in genau einem Worktree ausgecheckt sein.
  Die Git-Meldung, dass `main` bereits von einem anderen Worktree verwendet wird, nicht durch
  Löschen oder Umhängen dieses Worktrees umgehen; für den Auftrag stattdessen einen neuen
  Feature-Branch und Worktree von `origin/main` anlegen.
- Innerhalb derselben Aufgabe einmalig `/compact` empfehlen, wenn lange Logs, Fehlversuche oder
  viele Zwischenschritte den relevanten Kontext deutlich überlagern.
- Bei einer neuen Phase, einem neuen PR, einem anderen Branch oder einem wesentlich anderen Ziel die
  Bearbeitung pausieren, eine kurze dauerhafte Übergabe sicherstellen und eine neue Session
  empfehlen.
- Vor einer neuen Session nicht zusätzlich `/compact` verlangen; beides sind für diesen Fall
  Alternativen.
- Modell und Denkstufe nur zu Beginn eines neuen Arbeitsabschnitts oder bei deutlich veränderter
  Aufgabenart prüfen. Nur auf eine klar ungeeignete Auswahl hinweisen.
- Wenn keine Maßnahme erforderlich ist, diese Prüfung nicht erwähnen und direkt fortfahren.
- Für diese Prüfung keinen separaten Modell-, Tool- oder Subagentenaufruf starten.

## 3. Produktziele – in dieser Reihenfolge

1. **Zuverlässigkeit:** Das System läuft die gesamte dreitägige LAN ohne manuellen Neustart. Ein
   fehlerhafter oder verschwundener Client darf Server und andere Clients nicht beeinträchtigen.
2. **Einfache und schnelle Bedienung:** Wichtige Aktionen sind auf Handy und Laptop ohne Erklärung
   in wenigen Schritten erreichbar.
3. **Modernes, intuitives Design:** Aufgeräumt, dark-mode-freundlich, responsive und mit klaren,
   zugänglichen Zuständen für „spielt“, „pausiert“ und „offline“.
4. **Schlanke Wartbarkeit:** Keine unnötigen Abstraktionen oder Abhängigkeiten. Für rund 15
   Teilnehmende robust und verständlich bauen, nicht auf Enterprise-Skalierung optimieren.

Bei Zielkonflikten gewinnt die weiter oben stehende Priorität.

## 4. Gemeinsame Architektur- und Qualitätsgrenzen

- Node.js 24 ist über `.nvmrc` und die `engines`-Felder festgelegt. Entwicklung, CI, Docker und
  Paketierung dürfen nicht stillschweigend auf eine andere Hauptversion wechseln. Node.js wird
  einmal pro Rechner beziehungsweise Laufzeitumgebung bereitgestellt, nicht pro Branch. Neue
  Worktrees erhalten ihre nicht versionierten npm-Abhängigkeiten über
  `node scripts/worktree-bootstrap.mjs`; der bereichsspezifische Agent-Preflight ruft diesen
  Bootstrap nach bestandener Branch-Sicherheitsprüfung automatisch und idempotent auf.
- Architekturwechsel, neue Frameworks oder größere Produktionsabhängigkeiten nicht nebenbei
  einführen. Sie brauchen klaren Nutzen, Folgenabschätzung und Zustimmung des Nutzers.
- Arcade-Code nach Möglichkeit innerhalb der bestehenden Arcade-Grenzen kapseln
  (`server/src/arcade/`, `server/src/routes/arcade.ts` und die ausgewiesenen Arcade-Frontendmodule).
  Neue Arcade-Logik nicht in DB-, Realtime-, App-Shell-, Basis-CSS- oder andere Shared-Module
  einbetten, wenn eine schmale Schnittstelle möglich ist. Eine unvermeidbare neue Shared-Kopplung
  begründen und mit Vertrags- sowie Pfadklassifikationstests absichern, damit Core-, Arcade-Smoke-
  und vollständige Arcade-E2E-Läufe weiterhin gezielt auswählbar bleiben.
- Externe Eingaben nach Typ, Format, Länge, erlaubten Werten und referenzierten Entitäten
  validieren. Erwartbare Fehler dürfen keine ungefangenen Exceptions auslösen.
- Keine Secrets, API-Keys, produktiven Datenbanken oder personalisierten Konfigurationen committen.
- Bestehende Grenzen für Authentifizierung, Admin-Rechte, LAN-/Loopback-Bindung und Opt-in-
  Einstellungen nicht aus Bequemlichkeit aufweichen.
- Nutzerinhalte vor HTML-Ausgabe escapen und dynamische SQL-Werte parametrisieren.
- SQL-Bezeichner oder SQL-Fragmente nur aus internen Allow-Lists zusammensetzen.
- Neue oder geänderte Logik erhält Tests für Happy Path, relevante Validierungsfehler und
  Zustandskonflikte. Tests verwenden keine produktiven Daten, fremden Ports oder echte
  Nutzerkonfigurationen.
- Tests nicht löschen, lockern oder mit pauschalen Timeouts kaschieren, nur damit ein Lauf grün wird.
- Flaky Tests ursächlich stabilisieren.
- Nach jeder Umsetzung erfasst CI die reine Laufzeit der einschlägigen Testsuiten getrennt von
  Installation, Build und Browser-Setup. Mehr als 20 Prozent und zugleich mindestens 30 Sekunden
  gegenüber dem Median der letzten fünf erfolgreichen `main`-Läufe gelten als Verdacht auf eine
  Testlauf-Regression. Ein automatischer Wiederholungslauf muss den Verdacht bestätigen, bevor der
  Check fehlschlägt. Bestätigte Regressionen ursächlich untersuchen und reduzieren; notwendige,
  nicht weiter vermeidbare Laufzeit durch zusätzliche belastbare Abdeckung im PR begründen. Dabei
  niemals Tests löschen, lockern oder mit größeren Timeouts kaschieren.

## 5. Arbeitsbaum und Git

- Vor Änderungen `git status --short` prüfen.
- Vorhandene, nicht zum Auftrag gehörende Änderungen gehören dem Nutzer. Nicht überschreiben,
  zurücksetzen, verstecken, formatieren oder in eigene Commits aufnehmen.
- Nur Dateien im Auftragsscope ändern; keine beiläufigen Großformatierungen oder Refactorings.
- Nach dem Session-Hygiene-Check auf dem zur Aufgabe gehörenden Branch arbeiten. Der Auftrag zu
  einer neuen Änderung autorisiert genau einen neuen, aufgabenspezifischen Branch und Worktree,
  sofern der aktuelle Kontext nicht bereits nachweislich zu derselben Aufgabe und demselben PR
  gehört. Keine bestehenden Worktrees oder fremden Branches dafür umhängen.
- Ein Änderungsauftrag autorisiert nach erfolgreicher Umsetzung und den einschlägigen Prüfungen
  standardmäßig genau einen aufgabenspezifischen Commit, den Push des eigenen Feature-Branches und
  die Eröffnung eines Draft-PRs mit gültigem Task-Vertrag. Diese vorab erteilte
  Repository-Autorisierung ist innerhalb des eindeutig abgegrenzten Änderungsauftrags keine neue
  Berechtigung und keine schwer rückgängige externe Aktion im Sinne der allgemeinen Rückfrageregel
  aus `AGENTS.md`. Der Nutzer kann diesen Abschluss mit „nur lokal“, „nicht committen“, „nicht
  pushen“ oder „kein PR“ ganz oder teilweise ausschließen. Bei unklarem Änderungsscope,
  sachfremden Änderungen im Arbeitsbaum, fehlenden Berechtigungen, einer wesentlichen Erweiterung
  des Auftrags oder einer laut Abschnitt 12 des Pipeline-Konzepts kritischen Entscheidung vor der
  betroffenen Aktion anhalten. Niemals direkt auf `main` pushen, approven, mergen oder Auto-Merge
  aktivieren. Commits klein, in sich geschlossen und imperativ auf Englisch benennen.
- Abhängigkeiten und Lockfiles nur ändern, wenn sie notwendig sind; neue Pakete auf Wartung,
  Sicherheit und Offline-Auswirkungen prüfen.

## 6. Definition of Done

Eine Änderung ist fertig, wenn:

- das gewünschte Verhalten vollständig umgesetzt und ohne Erklärung auffindbar ist,
- Eingaben, Fehlerpfade und gegebenenfalls konkurrierende Zugriffe abgesichert sind,
- die einschlägigen Tests und statischen Prüfungen erfolgreich gelaufen sind,
- der Testlauf-Performance-Check keinen bestätigten ungeklärten Rückschritt meldet,
- Dokumentation und tatsächliches Verhalten übereinstimmen,
- keine Secrets, produktiven Daten oder sachfremden Änderungen enthalten sind,
- der Abschluss geänderte Bereiche, ausgeführte Prüfungen und verbleibende Einschränkungen nennt.

Kann eine erforderliche Prüfung nicht laufen, konkret nennen: welche Prüfung, warum und welches
Restrisiko bleibt.
