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

## 2. Produktziele – in dieser Reihenfolge

1. **Zuverlässigkeit:** Das System läuft die gesamte dreitägige LAN ohne manuellen Neustart. Ein
   fehlerhafter oder verschwundener Client darf Server und andere Clients nicht beeinträchtigen.
2. **Einfache und schnelle Bedienung:** Wichtige Aktionen sind auf Handy und Laptop ohne Erklärung
   in wenigen Schritten erreichbar.
3. **Modernes, intuitives Design:** Aufgeräumt, dark-mode-freundlich, responsive und mit klaren,
   zugänglichen Zuständen für „spielt“, „pausiert“ und „offline“.
4. **Schlanke Wartbarkeit:** Keine unnötigen Abstraktionen oder Abhängigkeiten. Für rund 15
   Teilnehmende robust und verständlich bauen, nicht auf Enterprise-Skalierung optimieren.

Bei Zielkonflikten gewinnt die weiter oben stehende Priorität.

## 3. Gemeinsame Architektur- und Qualitätsgrenzen

- Node.js 24 ist über `.nvmrc` und die `engines`-Felder festgelegt. Entwicklung, CI, Docker und
  Paketierung dürfen nicht stillschweigend auf eine andere Hauptversion wechseln.
- Architekturwechsel, neue Frameworks oder größere Produktionsabhängigkeiten nicht nebenbei
  einführen. Sie brauchen klaren Nutzen, Folgenabschätzung und Zustimmung des Nutzers.
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

## 4. Arbeitsbaum und Git

- Vor Änderungen `git status --short` prüfen.
- Vorhandene, nicht zum Auftrag gehörende Änderungen gehören dem Nutzer. Nicht überschreiben,
  zurücksetzen, verstecken, formatieren oder in eigene Commits aufnehmen.
- Nur Dateien im Auftragsscope ändern; keine beiläufigen Großformatierungen oder Refactorings.
- Auf dem aktuell gewählten Branch arbeiten. Branchwechsel oder neue Branches nur auf Wunsch.
- Commit und Push nur auf ausdrücklichen Wunsch. Commits klein, in sich geschlossen und imperativ
  auf Englisch benennen.
- Abhängigkeiten und Lockfiles nur ändern, wenn sie notwendig sind; neue Pakete auf Wartung,
  Sicherheit und Offline-Auswirkungen prüfen.

## 5. Definition of Done

Eine Änderung ist fertig, wenn:

- das gewünschte Verhalten vollständig umgesetzt und ohne Erklärung auffindbar ist,
- Eingaben, Fehlerpfade und gegebenenfalls konkurrierende Zugriffe abgesichert sind,
- die einschlägigen Tests und statischen Prüfungen erfolgreich gelaufen sind,
- Dokumentation und tatsächliches Verhalten übereinstimmen,
- keine Secrets, produktiven Daten oder sachfremden Änderungen enthalten sind,
- der Abschluss geänderte Bereiche, ausgeführte Prüfungen und verbleibende Einschränkungen nennt.

Kann eine erforderliche Prüfung nicht laufen, konkret nennen: welche Prüfung, warum und welches
Restrisiko bleibt.
