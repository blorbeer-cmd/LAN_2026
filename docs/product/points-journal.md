# Punktejournal und Kategorie-Konten

Dieses Paket liefert die interne Buchungsgrundlage für „Respawn – Punkte und Wertung“.
Die Spielberechnung wird separat in PR #752 geändert; das Zielkonzept steht in PR #751.

## Konten

Bei bestätigter Teilnahme werden im Hintergrund vier Event-Konten angelegt, auch ohne
sichtbare Punkteansichten. Vorhandene bestätigte Teilnehmer erhalten sie beim Upgrade.
Einladungen allein und der historische „Außerhalb von Events“-Datensatz erzeugen keine Konten.
Admins und Event-Ersteller werden wie alle anderen Teilnehmer behandelt.

| Konto | Inhalt |
|---|---|
| `orga` | Orga-Rohpunkte |
| `playing` | Spiel-Rohpunkte |
| `betting` | Nettoergebnis abgerechneter Wetten |
| `wallet` | Separates, für Wetten verfügbares Guthaben |

Alle Konten beginnen technisch bei 0. Dieses Paket entscheidet keine Höhe eines
Wett-Startguthabens und vergibt noch keine Aktivitätsboni. Ein späterer Startguthaben-Vorgang
bucht ausschließlich auf `wallet`. Orga- und Spielpunkte erhöhen dieses Guthaben nicht.
Offene Einsätze betreffen nur das Wallet; der Wett-Rohwert wird später aus abgerechneten
Nettoergebnissen gebucht. Vollständige Erstattungen ergeben dort 0. Wallet und Rohwerte
dürfen nach einer Korrektur negativ sein. Eine spätere Wettannahme muss negative Guthaben sperren.

## Buchung und Korrektur

`server/src/pointsJournal.ts` bietet ausschließlich interne Funktionen:

- `readPointsBalances(groupId, eventId, playerId)` liest die vier getrennten Summen.
- `readPointsSource(source)` liefert Stand und Revision eines Anspruchs.
- `readPointsJournal(groupId, eventId, playerId)` liest den Verlauf mit Zeitpunkt,
  Anlass, Betrag, Begründung, Kategorie, Vorgangsschlüssel und Revision.
- `recordPointsEntitlements(changes)` schreibt eine Gruppe zusammengehöriger Ansprüche atomar.

Kontostände werden immer aus dem Journal berechnet; es gibt keinen veränderlichen Saldo.
Ein Anspruch ist durch Event, Empfänger, Konto und kanonischen Vorgangsschlüssel eindeutig,
beispielsweise `todo:<id>` oder `match:<id>`. Aufrufer verwenden die Kennung des echten
Vorgangs, niemals eine neue Anfrage-UUID. Die spätere Fachlogik muss für Auslosung und
Turnierbegegnung dieselbe tatsächliche Partie erkennen, bevor sie einen Orga-Anspruch bucht.

Der Aufrufer übergibt den neu berechneten **Gesamtanspruch** sowie die erwartete Revision.
Das Journal bucht nur die Differenz zum bestehenden Anspruch. Beispiel: 5 Punkte für ein
To-do, Wiederöffnen auf 0 und erneutes Erledigen auf 5 erzeugen `+5 / −5 / +5`, insgesamt 5.
Wiederholungen desselben Gesamtanspruchs sind wirkungslos. Eine abweichende Buchung auf
einer veralteten Revision scheitert mit `PointsJournalConflict`; der Aufrufer muss den
Fachzustand neu lesen. Jede wirksame Korrektur benötigt eine Begründung.

Eine sofortige SQLite-Transaktion schützt auch vor unabhängigen gleichzeitigen Schreibern.
Scheitert ein Teil einer Buchungsgruppe, wird die gesamte Gruppe zurückgerollt. Damit können
spätere Markt-Abrechnungen Wallet- und Nettoanteile gemeinsam buchen. Die spätere Wettlogik
muss darüber hinaus die Nullsumme und die beschlossenen Auszahlungsregeln sicherstellen.

Journal und Vorgangsidentitäten sind gegen nachträgliches Ändern und einzelnes Löschen
geschützt. Ein Austritt beziehungsweise erneuter Beitritt zum Event lässt die Konten bestehen.
Die Ausnahme ist die vollständige Löschung des Events oder Benutzerkontos: Dann werden die
zugehörigen Konten, Ansprüche und Journaleinträge kaskadierend gelöscht. Der persönliche
Datenschutzexport enthält ausschließlich die eigenen Konten und Buchungen.

## Migration und nächste Pakete

Migration 125 legt die Tabellen an, übernimmt vorhandene Teilnahmen ohne Punkte zu erfinden
und ist wiederholbar. Die Nummern 123/124 bleiben für die noch offene ältere Punkte-/Wett-
Implementierung in PR #749 reserviert. Dessen Tabellen werden nicht umgedeutet oder gelöscht.
Eine Zusammenführung der älteren gemeinsamen Konten mit den neuen Konten ist kein Bestandteil
dieses Pakets; vor einer gemeinsamen Nutzung müssen deren Erzeuger und Leser umgestellt werden.

Es gibt keinen öffentlichen Schreibendpunkt und keine neue Punkteansicht. Die späteren
Fachhandler prüfen Berechtigungen, leiten Ansprüche aus Aktivitäten ab und rufen das Journal
auf. Es folgen administrative Korrekturen mit Befangenheitsprüfung, Anbindung der Spiel- und
Orga-Vorgänge, Wetten, Kategorie-Platzpunkte, Kontoansichten, Kiosk und Meldungen. Die bestehende
klassische Rangliste wird in diesem Paket nicht aus den neuen Konten gelesen.

**Offen bleiben:** Wett-Einsatzgrenze je Markt, Mindestzahl abgerechneter Tipps, erhöhte
To-do-Werte für Admins/Ersteller und Kontingente für Umfragen/Spieleabstimmungen. Dieses Paket
setzt dafür keine Vorgabewerte und entscheidet keine offenen Regeln zur Teilnehmerzahl der
Gesamtwertung oder zu persönlichen Bonus-Stichtagen.
