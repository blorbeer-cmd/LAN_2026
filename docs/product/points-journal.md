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

Orga-, Spiel- und Wett-Nettowerte beginnen bei 0. Das separate Wallet erhält einmalig fest
100 Wettpunkte für jeden berechtigten Teilnehmer eines LAN-Events, auch bei später Zusage. Gültige Spiele und Turnierplatzierungen erzeugen
automatisch Spielpunkte; organisierte Matches, Turniere und Sammelbestellungen erzeugen Orga-Punkte. Weitere
Orga-Auslöser folgen. Vollständige Skill-Einschätzungen erzeugen einmalig 5 Orga-Punkte je Event.
Dokumentierte frühere Spielteilnehmer
erhalten beziehungsweise behalten ihre Konten auch nach einem Austritt. Das legt weder die
Teilnehmerbasis der Gesamtwertung noch die Höhe eines Wett-Startguthabens fest. Der Startguthaben-Vorgang `wallet:start`
bucht ausschließlich auf `wallet`. Orga- und Spielpunkte erhöhen dieses Guthaben nicht.
Offene Einsätze reservieren nur das Wallet; der Wett-Rohwert wird aus abgerechneten
Nettoergebnissen gebucht. Vollständige Erstattungen ergeben dort 0. Wallet und Rohwerte
dürfen nach einer Korrektur negativ sein. Negative verfügbare Mittel sperren neue Tipps und Änderungen; die Rücknahme eines offenen Tipps bleibt möglich.

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

Beim Serverstart werden neue, nicht durch den Reset ausgeschlossene Ergebnisse offener Wertungen nachgetragen. Der Zustand
pro Quelle in `points_playing_awards` dient ausschließlich dem Abgleich; Kontostände bleiben
Journalsummen. Eine festgeschriebene Wertung bleibt unverändert. Nach dem begründeten
Wiederöffnen werden zwischenzeitliche Änderungen einmal nachgezogen. Der persönliche
Datenschutzexport enthält auch den eigenen automatischen Abgleichstand.

`GET /api/points` liefert zusätzlich `categoryBalances` und `categoryJournal` der angemeldeten
Person. Die vorhandenen Sichtbarkeitsregeln gelten auch für diese Daten. Die LAN-Ansicht zeigt die drei Kategorie-Rohwerte mit eigenem Verlauf. Das separate Wallet und seine Tipps verwenden dasselbe Journal; Spielpunkte erhöhen
das Wettguthaben nicht.

## Orga-Punkte für Wettbewerbe

Ein gültiges Match erzeugt **1 Orga-Punkt** für seinen gespeicherten Organisator. Bei einem
freien Match ist das der angemeldete Ersteller, bei einem Match aus einer Auslosung deren
ursprünglicher Ersteller. Auch Rematch-Auslosungen und abgeschlossene Captain-Drafts behalten
ihren Ersteller. Das bloße Erzeugen von Teams erzeugt keine Gutschrift. Es gelten dieselben
Kriterien für ein gültiges Ergebnis wie in der Spielwertung, einschließlich ausdrücklicher
Remis und vollständiger Platzierungen.

Der angemeldete Turnierersteller ist Turnierorganisator, auch wenn eine andere Person die
vorangehende Auslosung erstellt oder das spätere Ergebnis einträgt. Seine Zuordnung wird auf
jedes tatsächlich gespielte Turniermatch übernommen. Freilose erzeugen keine Matchpunkte.
Ein regulärer Abschluss erzeugt zusätzlich **5 Orga-Punkte**; vorzeitig beendete Turniere
erhalten diesen Abschlussbonus nicht.

Die kanonischen Orga-Quellen sind `match:<id>` und `tournament:<id>:completion`. Das ist pro
Konto eindeutig: Ein Turnierspiel erzeugt genau eine Matchbelohnung und keine zweite
Auslosungs- oder Turnierbegegnungsbelohnung. Ergebnisänderungen mit unverändertem Orga-Anspruch
lassen auch manuelle Korrekturen bestehen. Entfällt ein gültiges Ergebnis oder ein regulärer
Abschluss, wird der zugehörige Anspruch auf 0 neu berechnet. Bei erneuter Erfüllung gilt wieder
der fachliche Anspruch, ohne zusätzliche Auszahlung desselben Vorgangs.

Wird ein Turnier gelöscht, entfallen dessen Abschlussbonus und die Turnierverknüpfung;
weiter dokumentierte Matches behalten ihren ursprünglichen Organisator und genau einen
Matchpunkt. Werden die Matches selbst gelöscht, werden deren Orga-Punkte zurückgenommen.
Spiel- und Orga-Gutschriften laufen gemeinsam mit der jeweiligen Datenänderung in einer
Transaktion. Ausblenden der Punkteansichten hält sie nicht auf; festgeschriebene Wertungen
bleiben unverändert. Beim Wiederöffnen und Serverstart werden offene Ansprüche abgeglichen.

Migration 127 speichert die vom Server aus der Sitzung ermittelte, anschließend unveränderliche
Erstellerzuordnung an Matches, Turnieren, Auslosungen und Drafts. Vom Client übermittelte
Ersteller-IDs werden nicht übernommen. Historische Einträge ohne belegbaren Ersteller bleiben
ohne automatische Orga-Gutschrift; Event-Ersteller, Ergebniseintrager oder Sieger werden nicht
ersatzweise angenommen. `points_orga_awards` speichert nur den letzten automatischen Anspruch;
das Journal bleibt die Grundlage aller Salden. Der persönliche Export enthält eigene Ansprüche
und eigene Organisatorzuordnungen. Bei Kontolöschung werden diese Zuordnungen auf `NULL` gesetzt.

Die Kategorieansicht zeigt diese Buchungen im eigenen Saldo und Verlauf sowie im
Admin-Journal. Neue To-dos, Abstimmungen sowie Ankunfts-/Abreiseboni sind ebenfalls angebunden. Offene Grenzen und
Zuordnungsregeln aus dem Konzept werden dadurch nicht festgelegt.

## Orga-Punkte für Sammelbestellungen

Beim **Abschicken** (`closed_at`) entstehen automatisch die folgenden Ansprüche:

- Der Organisator erhält bei 3–5 anderen Bestellern 3 Punkte, bei 6–8 anderen 4 und ab 9
  anderen 5 Punkte; bei weniger als 3 anderen gibt es keinen Organisationsbonus.
- Jeder Besteller erhält 1 Punkt für seine gültig abgegebene eigene Bestellung. Mehrere
  Positionen oder größere Mengen erzeugen keinen weiteren Bonus. Das gilt auch für den
  Organisator, wenn er selbst bestellt; seine Bestellung erhöht die Zahl anderer Besteller nicht.

Es zählen unterschiedliche Personen mit mindestens einer noch vorhandenen, abgegebenen
Position. Die Bestellfrist (`send_at`) und der Zeitpunkt der Abgabe beeinflussen weder den
persönlichen Bonus noch die Organisatorstaffel. Beschreibung und Menge müssen wie bisher
gültig sein; der Preis bleibt nach den vorhandenen Bestellregeln optional. Ein bloßes Öffnen der Sammelbestellung oder das Markieren einer Zahlung gibt keine Punkte.

Die Quellen lauten `food-order:<id>:organization` beziehungsweise pro Besteller
`food-order:<id>:participation` im Konto `orga`. Beide sind unabhängig von Spiel- oder
Turnierquellen. Die gemeinsame Orga-Ableitung erhält alle weiterhin gültigen Ansprüche.
Es entstehen keine neuen Wallet-Punkte.

Das Wiederöffnen nur für Zahlungen (`finalized_at` zurücknehmen) lässt die Ansprüche bestehen.
Vollständiges Wiederöffnen zum Ändern der Positionen nimmt die bisherigen Bestellansprüche
zurück. Entfernte Positionen gelten als storniert. Erneutes Abschicken berechnet die Staffel
und die persönlichen Ansprüche neu, ohne zusätzliche Auszahlung derselben Quelle. Änderungen
der Bestellfrist ändern keine Punkteansprüche. Unveränderte fachliche Ansprüche behalten
manuelle Korrekturen; entfallene Ansprüche werden auf 0 berechnet. Das Löschen der Sammelbestellung
nimmt ihre Ansprüche zurück. Jede Änderung und die zugehörigen Journalbuchungen werden atomar
gespeichert; bei einem Buchungsfehler bleibt auch die Bestellung unverändert.

Die Vergabe läuft unabhängig von der Sichtbarkeit. Historische abgeschickte Bestellungen offener
Wertungen werden über den vorhandenen Startabgleich nachgetragen. Festgeschriebene Wertungen
bleiben unverändert, Wiederöffnen der Wertung zieht zwischenzeitliche Änderungen nach.
Die eigene Punkte-API (`categoryBalances`, `categoryJournal`) und der Datenschutzexport enthalten
die neuen Orga-Einträge. Die Kategorieoberfläche zeigt diese Buchungen mit Zeitpunkt, Anlass und Betrag. Dieses Paket benötigt
keine weitere Migration und entscheidet keine offenen To-do-, Abstimmungs- oder Wettregeln.

## Dauerhafter Skill-Bonus

Bestätigte Event-Teilnehmer erhalten einmalig **5 Orga-Punkte**, sobald sie alle aktuellen
Katalogspiele eingeschätzt haben. Maßgeblich sind die aufgenommenen Spiele der eigenen Gruppe
(`status = 'catalog'`, `arcade_key IS NULL`); Vorschläge und eingebaute Arcade-Spiele gehören
nicht dazu. Ein leerer Katalog erzeugt keinen Bonus. Jeder gültige Wert von 0 bis 5 zählt,
einschließlich 0 („kenne ich nicht“/„noch nie gespielt“). Die Höhe des Skills verändert die Punkte nicht.

Der kanonische Vorgang ist `bonus:skills` pro Person und Event. Der erste Journaleintrag nennt
die Zahl der damals eingeschätzten Katalogspiele. Der automatische Anspruch von 5 wird im
vorhandenen `points_orga_awards` dauerhaft festgehalten. Dieser Zustand ist kein berechneter
Kontostand und darf nicht aus dem später veränderten Skill-Profil neu aufgebaut werden.

Spätere Änderungen oder Löschungen von Einschätzungen, neue Katalogspiele und ein geänderter
Teilnehmerbestand nehmen einen erhaltenen Bonus nicht zurück und erzeugen keinen zweiten.
Eine begründete administrative Korrektur bleibt bestehen: Auch nach einem Entzug führt erneutes
Vervollständigen nicht zu einer neuen Auszahlung. Alle Salden stammen weiterhin aus dem Journal.

Die Prüfung erfolgt beim Ändern von Skills, vor Katalogänderungen sowie nach Aufnahme, Zurückstufen
oder Löschen von Katalogspielen. So geht ein bereits vollständiger Stand beim Hinzufügen eines
Spiels nicht verloren; das Entfernen eines bislang offenen Spiels kann die Vollständigkeit herstellen.
Skill-Daten und Katalog gelten für die Gruppe; alle bestätigten Event-Teilnahmen werden getrennt geprüft.
Vorhandene Einschätzungen zählen bei Event-Erstellung, Aufnahme in die Teilnehmerliste und
Bestätigung einer Einladung. Der jeweilige Quelldatensatz und die Gutschrift werden gemeinsam gespeichert;
ein Buchungsfehler rollt auch die Skill-, Katalog- oder Teilnahmeänderung zurück.

Der Startabgleich trägt fehlende Boni offener Wertungen nach. Ausgeblendete Punkteansichten
verhindern keine Vergabe. Festgeschriebene Wertungen bleiben unverändert; nach ihrem begründeten
Wiederöffnen werden dann vollständige Einschätzungen berücksichtigt. Eigene Kategorie-API und
Datenschutzexport enthalten Bonus und Verlauf. Die Kategorieoberfläche zeigt Bonus und Verlauf.
Es wird kein Wettguthaben erzeugt. Reiseboni und ihre offenen Stichtagsregeln gehören in ein Folgepaket.

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

`server/src/bettingAccounting.ts` ist an alle Wett-Handler angeschlossen. Pro Markt verwendet
er `bet:<roundId>` im Wallet und Wettkonto: offene/gesperrte Tipps reservieren ausschließlich den
Einsatz im Wallet, abgerechnete Tipps buchen Auszahlung minus Einsatz in beiden Konten.
Rücknahme beziehungsweise Erstattung setzen den Anspruch auf 0. Die Wallet-Summe ist das
verfügbare Guthaben; die API ergänzt die gehaltenen Einsätze für die Anzeige des Gesamtguthabens.
Die Marktabrechnung prüft Auszahlungen gegen Einsätze einschließlich anonymisierter Tipps.
Alle Spieler und beide Konten werden gemeinsam verbucht; Wiederholungen bleiben wirkungslos.
Finanzkorrekturen verknüpfen die Journalbuchungen mit dem handelnden Admin im Protokoll.

Journal und Vorgangsidentitäten sind gegen nachträgliches Ändern und einzelnes Löschen
geschützt. Ein Austritt beziehungsweise erneuter Beitritt zum Event lässt die Konten bestehen.
Die reguläre Ausnahme ist die vollständige Löschung des Events oder Benutzerkontos: Dann werden die
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

Dieser Korrekturendpunkt akzeptiert ausschließlich Orga- und Spielansprüche. Wallet und
Wett-Nettowerte dürfen nur durch begründete Markt-Neuberechnung oder Storno unter Erhaltung
der Nullsumme geändert werden (W6). Einseitige Korrekturversuche erhalten 409 und verändern
weder Journal noch Admin-Protokoll; das gilt auch für eigene Wettansprüche.

Eine aktuelle Revision ist auch bei eigenen Korrekturen erforderlich. Von zwei gleichzeitigen
Änderungen derselben Revision gewinnt höchstens eine; die andere erhält 409 und muss neu laden.
Unveränderte Ansprüche erzeugen keine weitere Buchung oder Protokollzeile. Eine wirksame
Änderung schreibt die Differenz und den Admin-Protokolleintrag in derselben Transaktion.
Scheitert das Protokoll, wird auch die Buchung zurückgerollt. Eine festgeschriebene Wertung
blockiert neue Korrekturen bis zum bestehenden begründeten Wiederöffnen.

Finanzielle Wettkorrekturen prüfen ebenfalls die aktive Adminrolle; eigene Markt-Neuberechnungen
und Stornos sind erlaubt. Der alte einseitige LAN-Entzugsendpunkt ist mit 409 abgeschaltet.

## Kategorieansicht und administratives Journal

Die Punkteansicht zeigt Orga, Spielen und Wetten als getrennte Rohwerte; sie werden nicht zu
vorläufigen Gesamtplatzpunkten addiert. Der Verlauf zeigt jeweils die ausgewählte Kategorie.
Die Suche filtert ausschließlich die Liste, die Kurve behält den vollständigen Kategorienverlauf.
Buchungsdetails nennen Kategorie, Zeitpunkt, Anlass, Betrag und gegebenenfalls Begründung.

In der Punkteverwaltung steht zusätzlich das Kategorie-Journal aller Teilnehmer mit Konto-
und Textfilter zur Verfügung. Orga- und Spielansprüche können aus jeder zugehörigen Buchung
korrigiert werden. Der Dialog verwendet den aktuellen Gesamtanspruch und die jüngste Revision
aller Buchungen dieses Vorgangs, auch wenn eine ältere Buchung ausgewählt wurde. Eigene
Korrekturen bleiben erlaubt. Mit 0 wird der ganze Anspruch entzogen; negative Ansprüche sind
möglich. Ein veralteter Bearbeitungsstand wird nicht überschrieben: Der Dialog schließt nach
409 und lädt den aktuellen Stand. Weitere Eingabefehler bleiben im offenen Dialog korrigierbar.

Ausblenden entfernt Kategorieansichten und offene Teilnehmerdetails. Das Admin-Journal bleibt
zugänglich; Admin-Dialoge schließen bei Event-, Konto- oder Rollenwechsel. Nach Festschreibung
ist das Journal lesbar, Korrekturen bleiben gesperrt. Wett-/Wallet-Einträge werden in dieser
Oberfläche ausschließlich lesend angeboten; finanzielle Korrekturen erfolgen am Markt. Fehler beim Laden des
Journals lassen sich über dessen Aktualisieren-Aktion erneut versuchen.

## Reiseangaben und Abstimmungen

Ankunfts- und Abreisezeit bringen bei Eventstart jeweils 2 dauerhafte Orga-Punkte, wenn die jeweilige Angabe bis zum Start eingetragen war. Ein Hintergrundlauf erfasst den Start auch ohne geöffneten Browser; unmittelbar vor späteren Änderungen wird der Stand ebenfalls gesichert. Optionaler Freitext ist nicht erforderlich. Verschiebungen vor der Vergabe verwenden den aktualisierten Start; bereits verbuchte Boni und administrative Korrekturen bleiben erhalten. Abgesagte, unveröffentlichte und bereits beendete Events erhalten keinen nachträglichen Reisebonus. Beim regulären Beenden eines laufenden Events wird der Anspruch zuvor gesichert.

Abgeschlossene allgemeine Umfragen mit drei unterschiedlichen Antwortenden bringen dem ursprünglichen Ersteller 3 Punkte, abgeschlossene Spieleabstimmungen mit drei unterschiedlichen Abstimmenden 2. Es gibt kein Kontingent. Zusammengehörige Stichwahlen gelten als eine Entscheidung. Abschluss beziehungsweise Wiederöffnen/Löschen und die Journaländerung erfolgen atomar; eingefrorene Wertungen bleiben unverändert. Historische Quellen ohne belegbaren Ersteller werden nicht zugeordnet.

## Neustart und Migrationen

**Nutzerentscheidung:** Für bestehende Events werden keine bisherigen Orga-, Spiel- oder
Wettpunkte übernommen. Migration 131 entfernt alte Journal- und gemeinsame Kontobuchungen,
Abgleichstände, To-do-Belohnungszusagen, Wettmärkte samt Tipps und Punkte-Endstände. Fachdaten
bleiben erhalten. Bereits abgeschlossene Quellen sowie bereits erfüllte persönliche Boni werden
in `points_reset_sources` festgehalten und von allen automatischen Erzeugern ausgeschlossen.
Das verhindert eine erneute historische Gutschrift nach Start, Reload, Änderungen oder Beitritt.
Neue Quellen werden regulär vergütet; offene Altaufgaben verwenden feste 3 Orga-Punkte.

Reset und einmalige Vergabe von 100 Wettpunkten laufen atomar. Der Marker `points_wallet_reset`
verhindert einen zweiten Reset bei Replay. Die Journal-Schutzregeln werden ausschließlich in
dieser ausdrücklich beschlossenen Migration kurz innerhalb derselben Transaktion aufgehoben
und anschließend wiederhergestellt. Reguläre Neuberechnungen verändern keine alten Buchungen.
Persönliche Reset-Quellen sind im eigenen Datenschutzexport enthalten und werden bei Kontolöschung
kaskadierend entfernt. Es wurde keine produktive Migration oder Auslieferung ausgeführt.

Migrationen 123/124 liefern die alten Tabellen und Grundeinstellungen, 125 die getrennten Konten,
126/127 automatische Spiel-/Orga-Abgleiche und Erstellerzuordnungen, 128 den Ergebnisfeed,
129/130 die festen To-do-Punkte. Diese historischen Migrationen bleiben erhalten. Seit 131
schreiben weder Grundstock, To-do-Abschluss noch Wettabschluss in `point_entries`.
Das alte Budget und einseitige Wallet-Entzüge sind als Finanzpfade abgeschaltet.

Die Journalbasis, Wallet-Abrechnung, Kategorie-Rohwerte und Admin-Korrekturen sind angebunden.
Paket 5b bietet bereits vorläufige Pool-Quoten und eine formatabhängige, regulär gewinnende
Remis-Auswahl. W1/W2/W5 sind entschieden: maximal 20 Punkte pro Person und Markt, mindestens
zwei regulär abgerechnete Tipps für eine Wettplatzierung und keine zusätzlichen Tages-/Rundenlimits.
Vollständig erstattete Märkte und zurückgenommene Tipps zählen nicht zur Mindestzahl; die Auszahlung
ist davon unabhängig. Die technische Umstellung steht noch aus. Markteröffnung und gleiche größte
Gewinner-Einsätze bleiben offen. Kategorieplätze,
Teilnehmerbasis N, Gesamtwertung, Meldefunktion und einheitliche Festschreibung folgen gemäß
[Implementierungsplan](../IMPLEMENTIERUNGSPLAN-PUNKTE-WERTUNG.md). Die vorläufigen Auswertungen
verwenden Spiel-Rohwerte, niemals Wallet-Summen als Gesamtwertung.
