# Respawn – Punkte und Wertung

**Status:** Beschlossenes Zielkonzept mit ausdrücklich offenen Entscheidungen. Die Umsetzung
erfolgt schrittweise im gemeinsamen Punkte-PR. Bereits umgesetzte Grundlagen und verbleibende
Arbeiten stehen in Abschnitt 12; das gesamte Zielkonzept ist noch nicht vollständig umgesetzt.

Das Konzept ersetzt die früheren Konzeptstände zu einer reinen Wetten-/Orga-Wertung,
zu 3/2/1 beziehungsweise 3/1/0 Spielpunkten, zu 8/5/3 Turnierboni und zur Normalisierung
auf den Kategorienführer. Der tatsächliche Implementierungsstand ist getrennt dokumentiert
unter [Produktregeln: Wettbewerb und Spiele](product/competition-and-game-rules.md#ranglistenpunkte).
Die nötigen Folgeänderungen stehen in Abschnitt 12.

## 1. Ziel und verbindliche Grundprinzipien

Es gibt die Kategorien **Wetten**, **Orga** und **Spielen**. Jede Kategorie hat eine eigene
Rangliste und einen Sieger. Aus den Platzpunkten aller drei Kategorien entsteht die
Gesamtwertung mit einem zusätzlichen Gesamtsieger. Mehrere Titel pro Person sind erlaubt.

- Alle regulären Gutschriften erfolgen automatisch. Es gibt keine Freigaben.
- Alle in Respawn dokumentierten Spiele mit gültigem Ergebnis zählen. Es gibt kein
  Kontingent gewerteter Spiele, keine Gegenbestätigung und keine Plausibilitätssperren.
- Spieldauer und wiederholte Begegnungen werden nicht gewichtet. Auch kurze Spiele und
  echte Wiederholungsspiele zählen vollständig. Das ist bewusst akzeptiert.
- Erfundene Spiele, absichtliches Verlieren und Absprachen lassen sich ohne unabhängigen
  Nachweis nicht zuverlässig erkennen. Die kleine Runde setzt bewusst auf Vertrauen.
- Die nachträglichen Gegenmaßnahmen sind transparente Ergebnisse im Kiosk, Meldungen und
  begründete administrative Punktekorrekturen. Eine Meldung hält keine Gutschrift auf.
- Admins und Event-Ersteller sind voll wertungsberechtigt. Admins dürfen auch eigene Punkte
  korrigieren oder entziehen. Dafür gelten dieselben Begründungs-, Journal- und Revisionsregeln
  wie bei fremden Punkten; es gibt keine zusätzliche Freigabe.
- Das Ein- oder Ausblenden der Punkteansichten verändert keine Ansprüche und setzt keine
  Punkte zurück. Die Erfassung läuft immer im Hintergrund.

## 2. Journal, Vorgänge und Zuständigkeiten

Jede Gutschrift erhält einen Journaleintrag mit Event, Empfänger, Kategorie, Zeitpunkt,
Anlass, Betrag und eindeutigem Vorgangsschlüssel. Der fachliche Anspruch eines Vorgangs
wird genau einmal erfasst; erneute Verarbeitung, Reload oder wiederholtes Speichern
erzeugen keinen zweiten Anspruch.

Korrekturen berechnen den richtigen Stand neu. Begründete Gegen- oder Differenzbuchungen
referenzieren den ursprünglichen Vorgang; die Historie bleibt nachvollziehbar. Ein
geändertes Ergebnis ist keine weitere Partie. Die dauerhaften persönlichen Boni aus
Abschnitt 5 bilden eine ausdrücklich festgelegte Ausnahme von einer automatischen Rücknahme.

Die eindeutige Kennung verhindert doppelte Verarbeitung desselben Datensatzes. Sie beweist
nicht, dass eine neu angelegte Partie tatsächlich gespielt wurde. Neue erfundene Datensätze
können deshalb weiterhin Punkte erzeugen; dieses Restrisiko wird bewusst akzeptiert.

Orga-Punkte für organisierte Aktivitäten erhält der verantwortliche Ersteller. Das reine
Eintragen eines fremden Ergebnisses erzeugt keine weitere Organisationsbelohnung.
Ausführende Helfer erhalten ihre To-do-Punkte nach Abschnitt 5.1. Persönliche Angaben und
eigene Bestellungen belohnen die jeweils betreffende Person.

Administrative Entzüge und Korrekturen benötigen eine Begründung und eine aktive Adminrolle.
Korrekturen mit Auswirkung auf die eigene Wertung sind ausdrücklich erlaubt und werden
ebenso nachvollziehbar protokolliert. Der Event-Ersteller erhält durch die Erstellerrolle allein keine
zusätzlichen administrativen Korrekturrechte.

## 3. Spielen

### 3.1 Punkte nach Platzierung

Für Teams und Einzelspieler gilt dieselbe Regel. Jeder Spieler eines Teams erhält den
vollen Wert seines Teamplatzes. Die Punkte gelten insgesamt pro Spiel, nicht zusätzlich
zu einem weiteren Teilnahmebonus.

| Platz im Spiel | Spielpunkte pro Person |
|---|---:|
| 1. Platz, sofern nicht zugleich letzter | 4 |
| 2. Platz, sofern nicht zugleich letzter | 3 |
| 3. Platz, sofern nicht zugleich letzter | 2 |
| Letzter Platz und jeder Platz ab dem 4. | 1 |

Der letzte Platz hat Vorrang vor den nominellen Werten für Platz 2 und 3. Daraus folgen
für vollständig angegebene, ungeteilte Platzierungen:

| Teams beziehungsweise Einzelspieler | Punktefolge |
|---|---|
| 2 | 4 / 1 |
| 3 | 4 / 3 / 1 |
| 4 | 4 / 3 / 2 / 1 |
| 8 | 4 / 3 / 2 / 1 / 1 / 1 / 1 / 1 |

### 3.2 Gleichplatzierungen und reine Siegereingabe

Gleichplatzierte belegen gemeinsam die entsprechenden aufeinanderfolgenden Plätze. Sie
erhalten jeweils den **abgerundeten Durchschnitt** der Punkte dieser Plätze, bezogen auf
die Zahl der Seiten in diesem Spiel.

- 1v1-Unentschieden: `abrunden((4 + 1) / 2) = 2` Punkte je Person beziehungsweise Teammitglied.
- Zwei Teams auf geteiltem Platz 1 bei insgesamt vier Teams:
  `abrunden((4 + 3) / 2) = 3` Punkte je Teammitglied.
- Zwei Teams auf geteiltem Platz 3 bei vier Teams: `abrunden((2 + 1) / 2) = 1` Punkt je Teammitglied.

**Sonderregel bei reiner Siegereingabe:** Ist nur der Sieger angegeben und fehlen die
weiteren Platzierungen, erhält der Sieger 4 Punkte. Alle übrigen Seiten gelten als
gemeinsamer letzter Platz und erhalten jeweils 1 Punkt. Aus den fehlenden Platzierungen
werden keine höheren Durchschnittspunkte abgeleitet.

### 3.3 Turnierboni

Regulär abgeschlossene Turniere geben zusätzlich pro Teammitglied beziehungsweise
Einzelspieler **5 / 3 / 1 Punkte für Platz 1 / 2 / 3**. Diese Werte sind entschieden;
der frühere Vorschlag 8/5/3 ist ersetzt. Tatsächlich gespielte Turniermatches zählen
zusätzlich als Spiele. Freilose erzeugen keine Punkte für ein gespieltes Match.

Eine Änderung des Turnierergebnisses berechnet die Wertung neu. Sie erzeugt keinen
zweiten Platzierungsbonus.

**Entschieden für manuelle Spielpunkte-Korrekturen:** Ändert sich später der tatsächliche
Punkteanspruch aus einem Spiel oder einer Turnierplatzierung, wird er aus dem neuen Ergebnis
neu berechnet und ersetzt den vorherigen, auch manuell korrigierten Anspruch. Eine Löschung
setzt ihn auf 0. Unveränderte Ansprüche, erneutes Speichern und Neustarts setzen manuelle
Korrekturen nicht zurück.

### 3.4 Bewusst akzeptierte Auswirkungen

Es gibt weder eine Zeitgewichtung noch einen Abschlag für wiederholte Begegnungen.
Häufiges Spielen und kurze Spiele können deshalb vorteilhaft sein. Aktivität soll belohnt
werden; daraus wird keine Sperre oder Begrenzung abgeleitet.

Der Nutzerhinweis lautet: „Spiele mit vielen Teams bringen pro Person im Schnitt etwas
mehr Punkte. Das ist akzeptiert, weil Aktivität belohnt werden soll.“

**Rechnerischer Klärungspunkt – OFFEN:** Diese pauschale Durchschnittsaussage folgt nicht
allgemein aus den beschlossenen Punktefolgen. Bei gleich großen Teams ergeben sich ohne
Gleichstände im Schnitt 2,5 Punkte bei zwei Teams, rund 2,67 bei drei, 2,5 bei vier und
1,75 bei acht Teams. Die festgelegten Punktefolgen und die fehlende Gewichtung bleiben
unverändert. Die Formulierung dieses Hinweises muss geklärt werden; sie ist keine Grundlage
für eine eigenmächtig geänderte Formel.

## 4. Wetten

### 4.1 Wettguthaben, Märkte und Quoten

Alle starten mit demselben separaten Wettguthaben. Es gehört nicht zur Gesamtwertung.
Orga- und Spielpunkte erhöhen das Wettguthaben nicht. Wetten verteilen vorhandene Einsätze
ohne Gebühr oder Hausanteil um; es entstehen und verschwinden keine Guthabenpunkte.

Tipps auf das eigene Spiel, das eigene Team, den Gegner und den Turniersieger bleiben
erlaubt. Auch Ergebniseintrager und Organisatoren dürfen tippen. Das Risiko absichtlicher
Niederlagen und abgesprochener Ergebnisse wird im Rahmen des Vertrauensprinzips akzeptiert.

Es gibt nur bewusst eröffnete offizielle Wettrunden mit ausdrücklichem Start beziehungsweise
Tippschluss. Eine neue Auslosung oder ein neues Spiel eröffnet nicht automatisch einen Markt.
Das betrifft ausschließlich Wetten; alle gültigen Spiele zählen weiterhin zur Spielwertung.

Es gelten Pool-Quoten. Vorläufige Quoten sind am Markt sichtbar und können sich mit den
Einsätzen verändern. Maßgeblich für die Abrechnung ist der Pool zum Tippschluss. Für einen
Ausgang mit Einsatz ist die Quote `Gesamttopf / Einsatz auf diesen Ausgang`; ohne Einsatz
ist für diesen Ausgang keine solche Quote berechenbar.

„Unentschieden“ ist als Tipp wählbar, wenn Spiel und Format es zulassen. Bei Turnier-K.-o.-
Spielen und Turniersieger-Märkten wird diese Option nicht angeboten.

### 4.2 Vollständige Rückerstattung

Der gesamte Markt wird erstattet, wenn:

- niemand auf das tatsächliche Ergebnis gesetzt hat;
- nur auf ein Ergebnis gesetzt wurde;
- ein Unentschieden eintritt, das am Markt nicht wählbar war;
- das Spiel abgesagt wird;
- der Markt bei der Festschreibung der Endwertung noch offen ist.

Eine vollständige Erstattung gibt die Einsätze zurück und erzeugt keinen Nettogewinn.
Ein wählbares und eingetretenes Unentschieden kann dagegen regulär gewinnen.

### 4.3 Auszahlung und Korrekturen

Die Gewinner teilen den Topf im Verhältnis ihrer Gewinner-Einsätze. Zunächst werden alle
Auszahlungen auf ganze Punkte abgerundet. Der verbleibende Rest geht nach fester Regel
an den größten Gewinner-Einsatz. Die Summe der Auszahlungen entspricht exakt dem Topf.

Beispiel: 5 und 3 Punkte auf A, 2 auf B; A gewinnt. Der Topf beträgt 10. Aus 6,25 und 3,75
werden zunächst 6 und 3. Der Restpunkt geht an den Einsatz von 5: Auszahlung **7 und 3**.
Das ersetzt die frühere Restverteilung nach größtem Nachkomma-Rest.

**OFFEN:** Die feste Reihenfolge bei mehreren gleich großen größten Gewinner-Einsätzen
ist noch festzulegen. Es wird hier kein zusätzliches Auswahlkriterium bestimmt.

Kontostände werden immer aus dem Journal neu berechnet. Eine Ergebniskorrektur nach einer
Auszahlung kann das Guthaben negativ machen, wenn Gewinne bereits weiterverwendet wurden.
Bei negativem Guthaben sind keine neuen Tipps möglich. Korrekturen werden nachvollziehbar
gebucht und erzeugen keinen zweiten Gewinnanspruch.

### 4.4 Wettwertung und offene Grenzen

Für die Kategorie zählt der **Nettogewinn** aus gültig abgerechneten Tipps: Auszahlung
minus Einsatz. Verluste werden mit Gewinnen verrechnet. Negative oder ausgeglichene
Bilanzen erhalten keine Platzierung und 0 Platzpunkte.

**OFFEN W1 – Einsatzgrenze je Markt:** Review-Vorschlag 10–20 % des Startguthabens.
Ein verbindlicher Wert ist nicht entschieden.

**OFFEN W2 – Mindestzahl abgerechneter Tipps für eine Wettplatzierung:** Review-Vorschlag
3–5. Weder die Zahl noch die genaue Behandlung erstatteter Märkte bei dieser Mindestzahl
sind entschieden. Die bisher beschlossene positive Nettobilanz bleibt notwendige Bedingung.

Begründung: Weil negative Bilanzen nicht zu negativen Platzpunkten führen, kosten riskante
Alles-oder-nichts-Tipps in der Gesamtwertung nach unten nichts. Die beiden vorgeschlagenen
Grenzen sollen diesen Anreiz mildern. Der Nutzer kann die angemessenen Werte derzeit nicht
beurteilen; die Vorschläge sind ausdrücklich keine beschlossenen Standardwerte.

## 5. Orga und organisatorische Mitwirkung

Die Kategorie belohnt praktische Hilfe, verlässliche Angaben und erfolgreich organisierte
Abläufe in Respawn. Die folgenden Sonderregeln ersetzen frühere Vorschläge, soweit sie
abweichen. Die übrigen Werte bleiben erhalten.

### 5.1 To-dos

- Teilnehmer vergeben beim Anlegen **1–5 Punkte**.
- Punkte entstehen nur für das Übernehmen **und** Erledigen eines To-dos, das jemand
  anderes angelegt hat. Das Anlegen allein und das Erledigen eigener To-dos bringen nichts.
- Ein To-do zahlt höchstens einmal aus. Wird es wieder geöffnet, wird die Gutschrift
  korrigiert. Erneutes Erledigen erzeugt keinen zusätzlichen Auszahlungsanspruch.
- Es gibt keine Freigabe der Erledigung und keine Gegenbestätigung.

**OFFEN O1:** Dürfen Admins oder Event-Ersteller höhere Werte vergeben, und falls ja bis
zu welchem Höchstwert? Die früheren 5–30 Punkte sind nur der Ausgangsvorschlag für diese
offene Ausnahme, kein allgemein geltender To-do-Wert.

**OFFEN – mehrere Helfer:** Wie der Anspruch bei mehreren ausführenden Helfern zugeordnet
oder aufgeteilt wird, ist nicht entschieden. Die Obergrenze von einer Auszahlung je
To-do bleibt bestehen; es wird keine zusätzliche Auszahlung pro Helfer angenommen.

### 5.2 Sammelbestellungen

Der Organisator erhält Punkte nach der Zahl **anderer unterschiedlicher Teilnehmer** mit
nicht stornierter Bestellung zum Bestellschluss. Die eigene Bestellung und mehrere
Bestellpositionen derselben Person erhöhen diese Teilnehmerzahl nicht.

| Andere Teilnehmer mit nicht stornierter Bestellung | Orga-Punkte |
|---|---:|
| Weniger als 3 | 0 |
| 3–5 | 3 |
| 6–8 | 4 |
| Ab 9 | 5 |

Spätere Stornos korrigieren die Gutschrift anhand dieser Staffel. Sinkt die Zahl
beispielsweise von 6 auf 5, wird aus der Gutschrift von 4 eine Gutschrift von 3 Punkten;
der Verlauf zeigt die Differenz von −1.

Der bisherige persönliche Bonus für eine vollständig und fristgerecht abgegebene eigene
Bestellung bleibt bei **1 Punkt**. Die Staffel der Sammelbestellung ersetzt nur die
früher pauschal vorgeschlagenen 3–5 Organisatorpunkte.

### 5.3 Dauerhafte persönliche Boni

| Beitrag | Punkte | Voraussetzung und Bestandsschutz |
|---|---:|---|
| Skill-Einschätzungen | 5 | Einmal je Event nach vollständiger Einschätzung des relevanten Spielkatalogs. Vorhandene Angaben und „noch nie gespielt“ zählen. Die Höhe des Skills ist irrelevant. |
| Ankunft | 2 | Bis zum Stichtag Eventstart vollständig eingetragen; einmal je Event. Vorhandene Angaben zählen. |
| Abreise | 2 | Bis zum Stichtag Eventstart vollständig eingetragen; einmal je Event. Vorhandene Angaben zählen. |

Ein einmal erhaltener Skill-Bonus bleibt dauerhaft erhalten, auch wenn sich der Katalog
ändert oder Einschätzungen gelöscht oder geändert werden. Neue Spiele lösen keinen
zweiten Bonus aus. Der relevante Katalog ist nachvollziehbar zu bestimmen; Änderungen
werden nicht als Gelegenheit für eine weitere Gutschrift verwendet.

Nach dem Stichtag bleiben rechtzeitig erworbene Ankunfts- und Abreiseboni ebenso
dauerhaft erhalten. Späteres Ändern oder Löschen der Angaben nimmt sie nicht automatisch
zurück. Dauerhaft bedeutet keine automatische Rücknahme bei Datenänderungen; die allgemeine
Möglichkeit einer begründeten administrativen Korrektur von Missbrauch bleibt bestehen.

**OFFEN – Stichtagsdetails:** Vorabgutschriften, Löschen vor dem Stichtag und spätere
Verschiebungen des Eventstarts sind nicht gesondert entschieden. Hier wird dafür keine
zusätzliche Verfalls- oder Rücknahmeregel festgelegt.

### 5.4 Matches, Turniere und Abstimmungen

| Organisatorischer Beitrag | Orga-Punkte | Auslöser |
|---|---:|---|
| Eigenständiges Match organisieren | 1 | Das angelegte Match erhält ein gültiges Ergebnis. |
| Turnierspiel organisieren | 1 | Ein tatsächlich gespieltes Turniermatch erhält ein gültiges Ergebnis; Empfänger ist der Turnierorganisator. Freilose zählen nicht. |
| Turnier abschließen | Zusätzlich 5 | Regulärer Turnierabschluss. |
| Allgemeine Umfrage veröffentlichen | 1 | Vollständige Veröffentlichung. |
| Allgemeine Umfrage abschließen | Zusätzlich 1 | Auswertbarer Abschluss mit mindestens zwei unterschiedlichen Antwortenden. |
| Spieleabstimmung organisieren | 1 | Erfolgreich abgeschlossene eindeutige Entscheidung mit mindestens zwei unterschiedlichen Antwortenden. |

Für Turnierspiele gibt es kein zusätzliches „Match organisiert“. Auslosung, Match und
Turnierbegegnung dürfen denselben Vorgang nicht mehrfach belohnen. Ein Turnier mit sieben
tatsächlich gespielten Begegnungen und regulärem Abschluss bringt dem Organisator
**7 + 5 = 12 Punkte**.

Stichwahlen gehören zur ursprünglichen Entscheidung und erzeugen keine weitere
Organisationsbelohnung. Allgemeine Umfragen und Spieleabstimmungen sind getrennte
Punktequellen; derselbe Vorgang wird nicht unter beiden Bezeichnungen doppelt belohnt.

**OFFEN O2:** Kontingente für vergütete Umfragen und Spieleabstimmungen pro Ersteller und
Event. Review-Vorschlag: 2–3. Verbindliche Zahl und genaue Aufteilung beziehungsweise
Zählweise der Veröffentlichungs- und Abschlussboni sind noch nicht entschieden.

## 6. Kategorieplätze und Gesamtwertung

### 6.1 Ablösung der Führer-Normalisierung

Die frühere Formel `100 × eigene Rohpunkte / Rohpunkte des Führers` entfällt vollständig.
Ein Ausreißer würde damit alle anderen stauchen, die effektive Gewichtung hinge von der
Streuung ab und Stände könnten ohne eigenes Zutun schwanken. Stattdessen zählen Plätze.

### 6.2 Platzpunkte

**N ist die Anzahl der Event-Teilnehmer**, nicht die Zahl der in einer Kategorie Platzierten.
Dasselbe N gilt für alle drei Kategorien.

- Nur ein positiver Rohwert erhält einen Kategorieplatz. Sonst gibt es keinen Platz und
  **0 Platzpunkte**. Für die Wettwertung ist zusätzlich die offene Entscheidung W2 zu beachten.
- Platz 1 erhält N Punkte, Platz 2 N−1 und so weiter: `Platzpunkte = N − Rang + 1`.
- Gleichstände teilen den besseren Rang. Nach zwei Personen auf Platz 2 folgt Platz 4:
  **1, 2, 2, 4**. Die beiden Zweitplatzierten erhalten beide N−1 Punkte.
- Rohwerte sind ganzzahlig. Gleichstände werden direkt nach Rohwert festgestellt;
  Anzeigerundung, Siege oder Namen entscheiden keinen Gleichstand dieser Kategorien.
- Eine Kategorie ohne wertbare Ergebnisse wird nicht ausgespielt.

Beispiel einer Kategorie bei N = 8:

| Person | Rohwert | Rang | Platzpunkte |
|---|---:|---:|---:|
| A | 20 | 1 | 8 |
| B | 12 | 2 | 7 |
| C | 12 | 2 | 7 |
| D | 4 | 4 | 5 |
| E–H | Je 0 oder negativ | Kein Platz | Je 0 |

**OFFEN – Teilnehmerbasis:** Die genaue Abgrenzung und der maßgebliche Stichtag für N bei
Zu- und Abmeldungen sind noch festzulegen. Dieses Konzept entscheidet sie nicht selbst.

### 6.3 Gesamtsieger und Anzeige

`Gesamtwertung = Platzpunkte Wetten + Platzpunkte Orga + Platzpunkte Spielen`

Die Höchstsumme beträgt **3 × N**. Auch in der Gesamtwertung teilen Gleichstände den Rang.
Eine nicht ausgespielte Kategorie liefert 0 Punkte; die anderen werden nicht höher skaliert.
Startguthaben und Rückerstattungen zählen nicht als verdiente Rohwerte oder Platzpunkte.

Das Konto zeigt pro Kategorie **Rohwert, Rang, Platzpunkte und Verlauf** mit Zeitpunkt,
Anlass und Betrag sowie die Summe der Platzpunkte als Gesamtwertung. Rohpunkte und
Platzpunkte sind klar bezeichnet und werden nicht miteinander addiert.

Vergeben werden die Titel für Wetten, Orga, Spielen und den Gesamtsieg. Eine Person darf
mehrere Titel gewinnen. Punktegleichstände bleiben geteilte Plätze.

## 7. Kiosk-Feed neuer Spielergebnisse

Der Kiosk zeigt laufend neue gültige Ergebnisse mit:

- Spiel;
- Teams beziehungsweise beteiligten Spielern;
- Platzierung;
- den dadurch gutgeschriebenen Spielpunkten.

Korrekturen erscheinen mit dem Hinweis **„korrigiert“**. Der Feed verwendet ausschließlich
Anzeigenamen und keine weiteren persönlichen Angaben. Sein Zweck ist Transparenz als
Ersatz für Freigaben, nicht eine Prüfung oder Gegenbestätigung der Ergebnisse.

Bei ausgeblendeten Punkteansichten bleibt der Ergebnis-Feed sichtbar. Er zeigt dann Spiel,
Teams beziehungsweise Anzeigenamen und Ergebnisplatzierung, aber **keine Punkte und keine
Punkteranglisten**. Die Platzierung des einzelnen Spielergebnisses ist vom Event-Rang zu
unterscheiden.

## 8. „Ungewöhnliche Punkte melden“

### 8.1 Melden und Wirkung

Teilnehmer können **Journaleinträge, Spielergebnisse, Wetten und To-dos** melden. Ein kurzer
Grund ist optional. Pro meldender Person und Eintrag gibt es höchstens eine offene Meldung.

Eine Meldung ändert nichts automatisch: keine Sperre, kein Einfrieren und keine Freigabe.
Punkte bleiben bestehen, bis eine Adminperson begründet korrigiert oder entzieht.
Eine solche Änderung erscheint nachvollziehbar im Journal.

### 8.2 Sichtbarkeit und Zuständigkeit

- Meldungen gehen an Admins und den Event-Ersteller.
- Betrifft eine Meldung einen Admin selbst, sehen sie ausschließlich die übrigen Admins
  beziehungsweise der Event-Ersteller. Ist der Ersteller zugleich der betroffene Admin,
  eröffnet die zweite Rolle keinen Zugriff auf die eigene Meldung.
- Die gemeldete Person sieht nicht, wer gemeldet hat. Rollen oder andere Ansichten dürfen
  die Identität des Meldenden nicht indirekt offenlegen.
- Der Event-Ersteller ohne Adminrolle kann Meldungen sehen; die Punkteentscheidung und
  der Abschluss der Meldung liegen bei einem Admin.
- Admins dürfen eigene Punkte korrigieren oder entziehen. Das erweitert weder den Zugriff
  auf Meldungen über sie selbst noch die Sichtbarkeit der Identität des Meldenden.

### 8.3 Bearbeitung und Abschluss

Ein Admin schließt eine Meldung als **„korrigiert“** oder **„in Ordnung“**. Der Meldende
sieht den Status. Ein Korrekturabschluss ersetzt nicht die begründete Journalbuchung.

Gemeldet werden kann bis zur Festschreibung. Festgeschrieben wird erst, wenn **keine
Meldung mehr offen** ist. Dies ist eine Abschlussbedingung und kein Freigabeprozess für
die laufende Punktevergabe.

**OFFEN – Meldungsempfänger und Bearbeitung:** Der Umgang mit Meldungen gegen einen nicht als Admin
handelnden Event-Ersteller sowie mit Fällen ohne verfügbare empfangsberechtigte Adminperson ist
noch zu präzisieren. Die Identität des Meldenden bleibt geschützt; es werden hier keine
zusätzlichen Meldungszugriffe oder Korrekturrechte für Nicht-Admins vergeben.

## 9. Sichtbarkeit und Festschreibung

Punkte werden immer im Hintergrund gesammelt. Admins und Event-Ersteller steuern die
Anzeige für das Event. Ausblenden verhindert neue Tipps; vorhandene Einsätze, Abrechnungen
und Gutschriften bleiben bestehen. Erneutes Anzeigen setzt weder Konten noch Verlauf zurück.
Der Ergebnis-Feed im Kiosk bleibt gemäß Abschnitt 7 sichtbar.

Die Endwertung wird als nachvollziehbarer Stand mit Rohwerten, Kategorieplätzen,
Platzpunkten, Gesamtsummen und den verwendeten Regeln festgeschrieben. Solange Meldungen
offen sind, ist das nicht möglich. Noch offene Wettmärkte werden bei der Festschreibung
vollständig erstattet; Startguthaben und diese Erstattungen erhöhen keine Wertung.

**OFFEN – gesperrte Wettmärkte:** Wie bereits geschlossene, aber noch nicht abgerechnete
Märkte bei der Festschreibung behandelt werden, ist mit der Regel zu noch offenen Märkten
nicht abschließend entschieden. Es wird keine zusätzliche automatische Behandlung erfunden.

## 10. Akzeptierte Restrisiken und weitere Hinweise

- Erfundene Spiele, Schein-To-dos, wechselseitige Gefälligkeitsleistungen und absichtliche
  Niederlagen bleiben möglich. Keine automatische Plausibilitätssperre wird daraus abgeleitet.
  Das Vertrauen der kleinen Runde, öffentliche Ergebnisse, Meldungen und begründete
  nachträgliche Korrekturen sind die gewählten Gegenmaßnahmen.
- Positive Nettogewinne können durch riskante Tipps entstehen, während negative Bilanzen
  0 Platzpunkte liefern. Einsatzgrenze und Mindestzahl Tipps sollen diesen Anreiz begrenzen,
  sind aber ausdrücklich noch offen.
- Werden Skill-Einschätzungen neben Wettmärkten angezeigt oder für Teamaufteilungen genutzt,
  kann Tiefstapeln lohnen. **Empfehlung aus dem Review:** Skills nicht neben Wettmärkten
  anzeigen. Bei skillbasierter Teamaufteilung bleibt das Manipulationsrisiko dennoch bestehen.
- Wer später anreist, ist in Orga und Spielen strukturell im Nachteil. Das wird akzeptiert;
  es wird kein Zeit- oder Nachzüglerausgleich eingeführt.
- Ein Rage-Quit-Token-Bonus bleibt **optional** und würde ausschließlich durch einen Admin
  vergeben. Punktehöhe und konkrete Ausgestaltung sind nicht beschlossen. Auch eigene
  Korrekturen oder Entzüge bleiben mit Begründung und Protokollierung erlaubt.

## 11. Offene Entscheidungen

Die folgenden vier Entscheidungen sind ausdrücklich **nicht getroffen**:

| Kennung | Offene Entscheidung | Review-Vorschlag, kein beschlossener Wert |
|---|---|---|
| W1 | Einsatzgrenze pro Wettmarkt | 10–20 % des gleichen Startguthabens |
| W2 | Mindestzahl abgerechneter Tipps für eine Wettplatzierung | 3–5; Zählweise erstatteter Märkte ebenfalls klären |
| O1 | Höhere To-do-Werte durch Admins oder Event-Ersteller und deren Höchstwert | Frühere 5–30 als Ausgangsvorschlag; Teilnehmergrenze bleibt 1–5 |
| O2 | Kontingente vergüteter Umfragen und Spieleabstimmungen pro Ersteller und Event | 2–3; genaue Zuordnung der Boni klären |

Weitere ausdrücklich offene Randfälle sind die widersprüchliche Durchschnittsaussage zur
Teamzahl, die Teilnehmerbasis für N, gleich große größte Gewinner-Einsätze bei der
Restverteilung, mehrere To-do-Helfer, Stichtagsdetails der Reiseboni, Meldungsbearbeitungsrandfälle
bei Meldungen und gesperrte, noch nicht abgerechnete Wettmärkte. Sie dürfen nicht durch
unbemerkte Implementierungsannahmen entschieden werden.

## 12. Umsetzungsstand und verbleibende Folgearbeiten

Die Spielberechnung, automatische Spiel- und Orga-Gutschriften für Wettbewerbe und Bestellungen sowie die Journalbasis mit Admin-Korrekturen
sind umgesetzt. Die bisherige sichtbare
LAN-Punkte-/Wettfunktion verwendet noch ihr gemeinsames Konto. Ihre Umstellung auf die drei
Kategorien, das separate Wallet und die weiteren Fachregeln erfolgt in den folgenden Paketen.
Bestehende Grenzen und Vorgabewerte der bisherigen Funktion entscheiden keine offenen Regeln
dieses Zielkonzepts.

| Bereich | Vermerkte Folgeänderung |
|---|---|
| Spielwertung | Umgesetzt: [server/src/leaderboard.ts](../server/src/leaderboard.ts) verwendet 4/3/2/1 einschließlich Letztplatz- und Gleichstandsregeln, Turnierboni bleiben 5/3/1. [Automatische Journalbuchungen](../server/src/playingPoints.ts) erfolgen bei Ergebnissen, Korrekturen, Löschungen und beim Nachtragen bestehender Ergebnisse. |
| Einheitliche Auswertung | [Rangliste](../server/src/routes/leaderboard.ts), [Hall of Fame](../server/src/routes/hallOfFame.ts), [gemeinsame Datenbasis](../server/src/leaderboardData.ts) und [Export](../server/src/routes/export.ts) müssen dieselbe Spielregel verwenden. Kategorieplätze, Gesamtwertung und geteilte Ränge sind konsistent abzubilden; eine Sortierung nach Siegen darf Kategoriegleichstände nicht auflösen. |
| Journal und Wettkonto | Umgesetzt: [Kategorie-Konten und Journalbasis](product/points-journal.md), automatische Spielgutschriften, eindeutige Vorgänge, begründete Admin-Korrekturen auch in eigener Sache, Differenzbuchungen, Journalsummen und negative Stände. Offen für die Folgepakete: weitere Orga-/Wett-Fachhandler und Ansichten anbinden sowie Kategorie-Platzpunkte berechnen. |
| Wettmärkte | Vorläufige Pool-Quoten sichtbar machen, formatabhängige Remis-Auswahl anbieten, die beschlossenen Erstattungen und Restverteilung umsetzen. W1, W2 und die offenen Randfälle nicht vorwegnehmen. |
| Orga | Umgesetzt: [Wettbewerbsorganisation](product/points-journal.md#orga-punkte-für-wettbewerbe) mit gespeicherten Erstellern, 1 Punkt pro gültigem Match und 5 pro regulärem Turnierabschluss, ohne Freilos- oder Doppelbelohnungen. Historische Wettbewerbe ohne belegbaren Ersteller erhalten keine automatische Orga-Zuordnung. Ebenfalls umgesetzt: [Sammelbestellstaffel und eigener Bestellbonus](product/points-journal.md#orga-punkte-für-sammelbestellungen) mit Fristprüfung, Stornokorrekturen und gemeinsamem Rollback. Offen für Folgepakete: fremde To-dos mit 1–5 Punkten, einmalige Auszahlung, Umfragen/Spieleabstimmungen sowie dauerhafte persönliche Boni mit Reisestichtag. Die ausdrücklich offenen Regeln bleiben offen. |
| Kiosk | [server/public/js/kiosk.js](../server/public/js/kiosk.js) um den Ergebnis-Feed mit Korrekturhinweis erweitern. Bei ausgeblendeten Punkteansichten Ergebnisse weiter zeigen, Punkte und Ranglisten verbergen. Nur Anzeigenamen verwenden. |
| Meldefunktion | Meldbare Quellen, optionalen Grund, eine offene Meldung pro Person/Eintrag, Empfängerfilter, Identitätsschutz, Status und begründete Korrekturen ergänzen. Eigene administrative Korrekturen bleiben erlaubt. |
| Abschluss und Sichtbarkeit | Hintergrundvergabe von der Anzeige trennen; neue Tipps bei ausgeblendeter Anzeige sperren. Festschreibung gegen gleichzeitig eingehende Meldungen absichern und bei offenen Meldungen verhindern. Den endgültigen Stand nachvollziehbar festhalten. |

Für die spätere Umsetzung sind mindestens die hier aufgeführten Rechenbeispiele,
Korrektur- und Rückerstattungsfälle, gleichzeitige Wiederholungsversuche, Rollen- und Meldungszugriffe
und die Sichtbarkeit des Kiosk-Feeds zu prüfen. Noch offene Fachfälle werden in den Folgepaketen
entsprechend abgesichert.
