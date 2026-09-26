# Branch: `codex/datenschutzpaket`

## Themenstrang

Dieser Branch ist mit 1 PR in der GitHub-Historie vertreten.

| PR | Status | Titel |
|---:|---|---|
| [#656](https://github.com/blorbeer-cmd/LAN_2026/pull/656) | offen (Draft) | Datenschutzpaket für private Dauernutzung |

## Inhalt

Der Branch begrenzt Prozessdiagnosen auf gültige Tracking-Einwilligungen, dokumentiert deren
Zweck und Textversion und ergänzt persönlichen Datenexport, vollständige Kontolöschung sowie
optionale Aufbewahrungsregeln. Hashbasierte Löschbelege verhindern, dass ein Restore bereits
gelöschte Konten unbemerkt wieder freigibt. Das Profil erklärt Datenarten und Widerruf; Fristen und
noch notwendige Betreiberentscheidungen stehen in der Betriebsdokumentation.

Die Review-Nacharbeit bindet aktive Erfassung strikt an die aktuelle Einwilligungsversion,
schreibt Löschbelege atomar, anonymisiert auch Profilbilder und Scribble-Namenskopien in
historischen Daten und erweitert den persönlichen Export um Sitz-, Ping-, Termin-, Arcade-,
Benachrichtigungs- und selbst erstellte Inhalte.

Die zweite Review-Nacharbeit stoppt die Agent-Allowlist auch bei einer Web-Pause, bereinigt
zusammengesetzte Teilnahme-Audit-IDs strukturiert, bewahrt fremde Musikwünsche beim Löschen eines
früheren Hosts und lässt nicht eindeutig zuordenbare Benachrichtigungsfreitexte unverändert.

Die dritte Review-Nacharbeit entfernt Spielerkennungen auch aus strukturierten Push-Schlüsseln,
nimmt zusammengesetzte Teilnahme-Audits in den persönlichen Export auf und blockiert die
Kontolöschung während eines laufenden Captain-Drafts, damit dieser konsistent abgeschlossen wird.
Der dabei wiederholt rote Checklisten-Browsertest wartet beim Kontowechsel nun auf die vollständig
geladene Personensicht und läuft dadurch auch im parallelen CI-Gesamtlauf stabil.

Die vierte Review-Nacharbeit sichert Löschbelege in einem append-only Ledger außerhalb der
SQLite-Datei, entfernt Kontonamen aus Fehlanmeldungs-Audits und aus systemgenerierten
Benachrichtigungen über das eigene Konto, nimmt Draft-, Turnier- und Matchteilnahmen in den
persönlichen Export auf und hält die Datenschutzansicht bei schnell aufeinanderfolgenden
Einwilligungsänderungen aktuell. Zusätzlich bereinigt die Löschung jetzt auch den dauerhaften
Raumsitzplan einer Community, das Produktions-Image enthält das im Restore-Runbook vorgeschriebene
Abgleichsskript, die Blockermeldungen unterscheiden Selbstlöschung und Adminfall, und eine zweite
Löschung überschreibt keinen anonymisierten Eintrag einer früheren Löschung mehr.

Die fünfte Review-Nacharbeit löscht den selbst geschriebenen Übernahmekommentar einer fremden
Checklistenaufgabe mit dem Konto, leert beim Einwilligungswiderruf auch den bereits gespeicherten
Prozess-Snapshot der Agent-Diagnose, sobald kein gültiger Tracking-Kontext mehr besteht, und listet
unversionierte Alteinwilligungen zu Events in der Datenschutzansicht als eigene, widerrufbare
Gruppe.

Die sechste Nacharbeit schärft, welche Bereiche überhaupt trackbar sind, und nimmt den Mitgliedern
die Wiederholungsarbeit ab: Der dauerhaft geöffnete Bereich „Allgemein“ und allgemeine Events sind
vom Tracking ausgeschlossen, eine Gruppe kann von der Orga freigeschaltet werden und wird danach
wie ein Event einzeln eingewilligt, und im Profil lässt sich eine stehende, an die Textversion
gebundene Vorab-Einwilligung für künftige trackbare Events setzen. Migration 110 setzt ein in
Altbeständen gestartetes Tracking des Basisbereichs zurück und ergänzt die Profilspalte.

Die Profilansicht zeigt keine Aufbewahrungsregeln mehr. Nicht trackbare allgemeine Bereiche fehlen
in der Einwilligungsauswahl; alte Zustimmungen bleiben unter verständlichen Bezeichnungen
widerrufbar, ohne den früheren Namen „RespawnHQ“ anzuzeigen. Die Erklärung der Vorab-Zustimmung
steht neben der Checkbox in einem Tooltip.

## Offene Punkte

Review und Merge stehen aus. Die automatische Bereinigung bleibt bis zur Betreiberentscheidung
standardmäßig deaktiviert.
