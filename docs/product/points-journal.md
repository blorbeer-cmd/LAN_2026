# Punktejournal und Kategorie-Konten

Dieses Paket liefert die interne Buchungsgrundlage für „Respawn – Punkte und Wertung“.
Spielberechnung, Journalbasis und das [Zielkonzept](../KONZEPT-PUNKTE-WERTUNG.md)
werden zusammen mit der bisherigen LAN-Punkte-/Wettfunktion im gemeinsamen PR #749 geführt.

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

Die neuen Konten beginnen technisch bei 0. Gültige Spiele und Turnierplatzierungen erzeugen
automatisch Spielpunkte; weitere Orga-Auslöser folgen. Dokumentierte frühere Spielteilnehmer
erhalten beziehungsweise behalten ihre Konten auch nach einem Austritt. Das legt weder die
Teilnehmerbasis der Gesamtwertung noch die Höhe eines Wett-Startguthabens fest. Ein späterer Startguthaben-Vorgang
bucht ausschließlich auf `wallet`. Orga- und Spielpunkte erhöhen dieses Guthaben nicht.
Offene Einsätze betreffen nur das Wallet; der Wett-Rohwert wird später aus abgerechneten
Nettoergebnissen gebucht. Vollständige Erstattungen ergeben dort 0. Wallet und Rohwerte
dürfen nach einer Korrektur negativ sein. Eine spätere Wettannahme muss negative Guthaben sperren.

## Automatische Spielpunkte

Freie Ergebnisse und tatsächlich gespielte Turniermatches werden beim Speichern in derselben
Transaktion wie die Spielpunkte verbucht. Rangliste und Journal teilen sich die
[Spielberechnung](competition-and-game-rules.md#ranglistenpunkte). Alle Teammitglieder erhalten
die Punkte ihrer Platzierung. Es gibt keine Freigabe, Spielkontingente, Dauergewichtung oder
Abschläge für wiederholte Begegnungen.

Ein Match hat den Schlüssel `match:<id>`, unabhängig von verknüpfter Auslosung oder
Turnierbegegnung. Die Quelle wird einmal pro Spieler gebucht. Reguläre Turnierabschlüsse
erhalten zusätzlich `tournament:<id>:placement` mit 5/3/1; Freilose erzeugen keine Matchpunkte.
Wiederöffnen eines Turniers entfernt vorläufig seine Platzierungsboni. Löschen entfernt den
Anspruch der jeweiligen Quelle; beim Turnierlöschen bleiben die weiterhin dokumentierten
Matches bestehen. Auch Katalog- und Auslosungslöschungen korrigieren die Ansprüche atomar.

**Entschiedene Neuberechnung:** Ändert sich der tatsächliche Punkteanspruch, ersetzt der aus
dem neuen Ergebnis berechnete Wert den vorherigen Anspruch einschließlich einer manuellen
Korrektur. Eine Löschung berechnet den Anspruch auf 0. Unveränderte Punkteansprüche,
wiederholtes Speichern, andere Matches und Neustarts setzen manuelle Korrekturen nicht zurück.
Bei der erstmaligen Übernahme bereits vorhandener Journalansprüche bleibt deren Stand erhalten;
erst eine anschließende Änderung des automatischen Anspruchs löst eine neue Berechnung aus.

Beim Serverstart werden vorhandene Ergebnisse offener Wertungen nachgetragen. Der Zustand
pro Quelle in `points_playing_awards` dient ausschließlich dem Abgleich; Kontostände bleiben
Journalsummen. Eine festgeschriebene Wertung bleibt unverändert. Nach dem begründeten
Wiederöffnen werden zwischenzeitliche Änderungen einmal nachgezogen. Der persönliche
Datenschutzexport enthält auch den eigenen automatischen Abgleichstand.

`GET /api/points` liefert zusätzlich `categoryBalances` und `categoryJournal` der angemeldeten
Person. Die vorhandenen Sichtbarkeitsregeln gelten auch für diese Daten. Die sichtbare
LAN-Ansicht bleibt bis zum Ansichtenpaket beim bisherigen Konto; Spielpunkte erhöhen dessen
Wettguthaben nicht.

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

## Administrative Korrekturen

Aktive Community-Admins und Owner können bestehende Ansprüche begründet korrigieren,
auch die eigenen. Die Event-Erstellerrolle allein gewährt keine Korrekturrechte.

- `GET /api/points/admin/journal` liefert das Journal des gewählten Events einschließlich
  Empfänger und protokollierendem Admin bei manuellen Korrekturen.
- `POST /api/points/admin/journal/:id/correct` erwartet `total` (neuer Gesamtanspruch dieses
  Vorgangs), `revision` (aktuelle Vorgangsrevision) und `reason`. Der Empfänger, das Konto
  und der Vorgang stammen aus dem vorhandenen Eintrag; der handelnde Admin aus der Sitzung.

Eine aktuelle Revision ist auch bei eigenen Korrekturen erforderlich. Von zwei gleichzeitigen
Änderungen derselben Revision gewinnt höchstens eine; die andere erhält 409 und muss neu laden.
Unveränderte Ansprüche erzeugen keine weitere Buchung oder Protokollzeile. Eine wirksame
Änderung schreibt die Differenz und den Admin-Protokolleintrag in derselben Transaktion.
Scheitert das Protokoll, wird auch die Buchung zurückgerollt. Eine festgeschriebene Wertung
blockiert neue Korrekturen bis zum bestehenden begründeten Wiederöffnen.

Die bisherigen LAN-Entzüge und finanziellen Wettkorrekturen prüfen ebenfalls die aktive
Adminrolle; eigene Entzüge, Korrekturen und Stornos sind erlaubt. Ein wiederholter LAN-Entzug
mit derselben Vorgangskennung erzeugt weder eine zweite Buchung noch ein zweites Protokoll.

## Migration und nächste Pakete

Migration 125 legt die Tabellen an, übernimmt vorhandene Teilnahmen ohne Punkte zu erfinden
und ist wiederholbar. Die Migrationen 123/124 enthalten die bisherige Punkte-/Wettfunktion;
125 ergänzt die getrennte Journalbasis. Die bisherigen Tabellen werden nicht umgedeutet oder gelöscht.
Migration 126 ergänzt den automatischen Abgleich für Spielansprüche. Die Gutschriften erfolgen
durch die gemeinsame Fachlogik beim Start beziehungsweise bei den jeweiligen Spieländerungen;
bestehende Journaleinträge werden nicht umgeschrieben.
Eine Zusammenführung der älteren gemeinsamen Konten mit den neuen Konten ist kein Bestandteil
dieses Pakets; vor einer gemeinsamen Nutzung müssen deren Erzeuger und Leser umgestellt werden.

Die neue Journalbasis hat geschützte Administrationsendpunkte und noch keine eigene Punkteansicht.
Die bisherige [LAN-Punkteansicht](lan-points-and-betting-rules.md) nutzt noch das bisherige Konto. Die späteren
Fachhandler prüfen Berechtigungen, leiten Ansprüche aus Aktivitäten ab und rufen das Journal
auf. Spielvorgänge und administrative Korrekturen sind angebunden; es folgen zusätzliche
Orga-Vorgänge, Wetten, Kategorie-Platzpunkte, Kontoansichten, Kiosk und Meldungen. Die bestehende
klassische Rangliste wird in diesem Paket nicht aus den neuen Konten gelesen.

**Offen bleiben:** Wett-Einsatzgrenze je Markt, Mindestzahl abgerechneter Tipps, erhöhte
To-do-Werte für Admins/Ersteller und Kontingente für Umfragen/Spieleabstimmungen. Dieses Paket
setzt dafür keine Vorgabewerte und entscheidet keine offenen Regeln zur Teilnehmerzahl der
Gesamtwertung oder zu persönlichen Bonus-Stichtagen.
