# Feedback – Respawn

Strukturierte Feedbackliste zur gemeinsamen Durchsicht und späteren Abarbeitung.

## Verwendung

- Erste Checkbox: Umsetzungsstand durch Codex
- Zweite Checkbox: deine visuelle und fachliche Abnahme
- `[x] [ ]` umgesetzt, deine Abnahme steht noch aus
- `[ ] [ ]` noch offen oder bewusst zurückgestellt
- Kommentare und Entscheidungen direkt unter dem jeweiligen Punkt ergänzen
- Punkte mit einer offenen Frage zuerst gemeinsam entscheiden
- `Kommentar (Usermanagement)` kennzeichnet Punkte, die bis zur Umsetzung des Konzepts in
  `docs/KONZEPT-USER-MANAGEMENT.md` bewusst nicht angefasst werden.

---

## Generell

- [x] [ ] Produktname vollständig auf „Respawn“ vereinheitlichen
  - [x] [ ] Wortmarke oben links bereits als „Respawn“ und nicht kursiv darstellen
  - [ ] [ ] Repo und alle Referenzen zu Respawn ebenfalls umbenennen
- [x] [ ] Kreuz zum Schließen der Meldungen reparieren; aktuell reagiert es nicht
  - Kommentar: Der vorhandene Schließpfad funktioniert im E2E-Test; kein zusätzlicher Code-Fix war nötig.
- [x] [ ] Symbole in den Untermenüs unter „Mehr“ entfernen und dort nur den Titel anzeigen
  - [x] [ ] Darstellung über alle in diesem UI-PR bearbeiteten Untermenüs konsistent machen
- [ ] [ ] Symbole aus den bunt gestalteten Buttons generell entfernen
  - Notiz: Die Buttons wirken dadurch cleaner und einheitlicher.
- [x] [ ] Gekürzte, aber weiterhin hilfreiche Erklärtexte über ein einheitliches Info-Tooltip anbieten
  - [x] [ ] Infosymbol direkt neben dem zugehörigen Titel oder Feldnamen anzeigen
  - [x] [ ] Tooltip optisch an das bestehende Design-System anpassen
  - [x] [ ] Bedienung per Maus, Tastatur und Touch sicherstellen
  - Notiz: Beispiel „Captain Draft“: sichtbar bleibt „2–4 Captains wählen“; das Infosymbol erklärt
    „2–4 Captains antippen – sie picken dann abwechselnd live aus den übrigen angehakten Spielern.
    Alle können auf ihrem Handy zusehen.“

## Home

- [x] [ ] Meldungsbereich vereinheitlichen und grundsätzlich nur die neueste Meldung anzeigen
  - Notiz: Aktuell erscheinen unter anderem Admin-Modus, „Neue Sammelbestellung“ und die Sammelbestellung selbst mehrfach bzw. in unterschiedlichen Stilen.
  - Kommentar (Usermanagement): Auf ausdrücklichen Wunsch bereits mit der aktuell lokal gewählten
    Spieleridentität umgesetzt. Ein künftiges Usermanagement muss diese Zuordnung auf die echte
    Session-Identität umstellen; Login, Rollen und Event-Scoping bleiben weiterhin außen vor.
- [ ] [ ] Prüfen, warum der Status immer „Offline“ ist
  - [ ] [ ] Agent-Anbindung prüfen
  - [ ] [ ] Falls der Status nicht zuverlässig über den Browser ermittelt werden kann: Statusanzeige entfernen
- [x] [ ] „Aktuell“ nach oben setzen
- [x] [ ] „Dein Status“ nach unten verschieben, direkt über die anderen Statusinformationen
- [x] [ ] „Aktuell“ für mehrere nebeneinanderstehende Kacheln vorbereiten
- [x] [ ] „Ganze Rangliste“ in „Gesamte Rangliste“ umbenennen
- [x] [ ] Sitzplan mit einem Titel oben links versehen, analog zu Rangliste und Status
- [x] [ ] „Mitteilungen“ aus dem unteren Seitenbereich herauslösen
  - [x] [ ] Glocken-Symbol in der oberen Leiste bei Profil, Einstellungen und GitHub ergänzen
  - [x] [ ] Mitteilungen dort als Liste anzeigen
  - [x] [ ] Mitteilungen als gelesen markieren können
  - [x] [ ] Mitteilungen entfernen können
  - Kommentar (Usermanagement): Gelesen- und Ausblendestatus sind vorläufig an die aktuell lokal
    gewählte Spieleridentität gebunden. Ein künftiges Usermanagement muss diese Bindung auf die
    authentifizierte Session migrieren; Push-Abos und Event-Sichtbarkeit bleiben unverändert.

## Turniere

- [x] [ ] Spielerauswahl beim Erstellen eines Turniers in 2–4 Kachelbreiten nebeneinander darstellen
  - Notiz: Dadurch wird weniger gescrollt und die Auswahl übersichtlicher.
- [x] [ ] Button „Alle markieren“ neben „Anzahl Teams“ ergänzen
- [x] [ ] Button „Auswahl aufheben“ neben „Anzahl Teams“ ergänzen
- [x] [ ] „Sitznachbarn bevorzugt ins selbe Team losen“ in „Sitznachbarn zusammen“ umbenennen
- [x] [ ] Symbole bei den Checkboxen entfernen
  - [x] [ ] Sitznachbarn
  - [x] [ ] Hin- und Rückspiel
  - [x] [ ] Ergebnisse mit Punktestand
- [x] [ ] „Hin- und Rückspiele (jeder spielt zweimal gegen jeden)“ in „Hin- und Rückspiel“ umbenennen
- [x] [ ] „Ergebnisse mit Punktestand erfassen (statt nur Sieg/Niederlage)“ in „Ergebnisse inkl. Punktestand“ umbenennen

## Teams

- [x] [ ] Aufbau und allgemeines Feedback aus dem Bereich „Turniere“ auch auf „Teams“ übertragen
- [x] [ ] Hinweis „Anzahl Teams leer lassen für automatisch (Standard: 2)“ entfernen
- [x] [ ] Stattdessen standardmäßig die Zahl 2 eintragen
- [x] [ ] „Oder: Captain-Draft“ in „Captain Draft“ umbenennen
  - [x] [ ] Symbol entfernen
  - [x] [ ] „Oder“ entfernen
- [x] [ ] „2–4 Captains antippen – sie picken dann abwechselnd live aus den übrigen angehakten Spielern. Alle können auf ihrem Handy zusehen.“ auf „2–4 Captains wählen“ kürzen
- [x] [ ] „Kraft starten“ mittig unter „Teams auslosen“ ausrichten
- [x] [ ] „Kraft starten“ bei einer gültigen Draft-Auswahl visuell wie „Teams auslosen“ gestalten
- [x] [ ] Symbol bei „Team-Historie“ entfernen
- [x] [ ] „Team-Historie“ standardmäßig einklappen
  - Notiz: Die Historie kann schnell sehr lang werden.

## Vote

- [x] [ ] Hinweis „Du bist …“ entfernen
  - Kommentar: Bei bekannter lokaler Identität wird die gemeinsame `whoami.js`-Karte nicht mehr
    angezeigt. Erstauswahl und Profilwechsel bleiben bis zur Session-Identität verfügbar.
- [x] [ ] Symbol bei „Neue Abstimmung starten“ entfernen
- [x] [ ] Buttons „Bewertung abschicken“ und „Beenden und Gewinner küren“ sauber aufeinander ausrichten
- [x] [ ] Beschreibung kürzen auf: „Punkte frei verteilen, höchste Summe gewinnt.“
  - [x] [ ] Symbol entfernen
  - [x] [ ] Einmalige Gender-Formulierung in diesem Text entfernen
- [x] [ ] Prüfen, ob grundsätzlich zwei Spiele nebeneinander dargestellt werden können
  - Notiz: Der Platz dafür scheint vorhanden zu sein.
- [x] [ ] „Vote-Historie“ standardmäßig einklappen
- [x] [ ] Symbol in der Überschrift der „Vote-Historie“ ergänzen
- [x] [ ] Erklärung „Antippen für die genaue Punkteverteilung dieser Runde.“ entfernen

## Rang

- [x] [ ] Symbol bei „Spielzeit“ entfernen
- [x] [ ] „Spielzeit pro Spiel (alle zusammen)“ in „Spielzeit pro Spiel“ umbenennen
- [x] [ ] Symbol bei „Spielzeit pro Spiel“ entfernen
- [x] [ ] Beim Eintragen eines neuen Ergebnisses „Frei für alle (kein Team, jeder für sich)“ in „Frei-für-alle“ umbenennen
  - [x] [ ] Symbol entfernen
- [x] [ ] „Werte / Platzierung …“ in „Werte / Platzierung eintragen“ umbenennen
  - [x] [ ] Symbol entfernen
- [x] [ ] Spieler-Zuordnung ausrichten
  - Notiz: Die Dropdown-Boxen sind aktuell je nach Länge des Spielernamens unterschiedlich eingerückt.

## Mehr

- [x] [ ] Anordnung der Kacheln festlegen
  - [ ] [ ] Entweder fachlich sinnvoll sortieren
  - [x] [ ] Oder alphabetisch sortieren

## Info-Board

- [x] [ ] Prüfen, ob einzelne Inhalte größer dargestellt werden sollten
- [x] [ ] Symbol innerhalb des Info-Boards entfernen

## Spiele

- [x] [ ] Symbol im Seitentitel „Spiele“ entfernen
  - Notiz: Ansonsten ist die Seite aus Sicht des Feedbacks fertig.

## Essen

- [x] [ ] Symbol im Seitentitel entfernen
- [x] [ ] „Essen bestellen“ in „Essen“ umbenennen
- [x] [ ] Hinweis „Du bist …“ entfernen
  - Kommentar: Zentral über `whoami.js` umgesetzt; Profilwechsel bleibt unter „Mein Profil“ möglich.
- [x] [ ] „+ Info & Link“ in „Info“ umbenennen
- [x] [ ] Bezeichnungen in den Infos vereinfachen
  - [x] [ ] „Geht raus um“ in „Versand“ umbenennen
  - [x] [ ] „Link zur Karte / Lieferdienst“ in „Link“ umbenennen
  - [x] [ ] Hinweis „Leer lassen entfernt das jeweilige Feld.“ entfernen
- [x] [ ] Für die Datumsauswahl dasselbe Widget wie bei An- und Abreise verwenden

## Arcade

- [x] [ ] Hinweis „Du bist …“ entfernen
  - Kommentar: Zentral über `whoami.js` umgesetzt; Profilwechsel bleibt unter „Mein Profil“ möglich.
- [x] [ ] Symbol beim Seitentitel „Spiele“ entfernen
- [x] [ ] Beschreibung der Kachel „… aktuell mit Mehrspieler-Gaming-Quiz.“ in „Minigame-Lobbies“ ändern
  - Notiz: Die Anordnung wirkt grundsätzlich gut; die Spiele selbst wurden zuletzt nicht erneut geprüft.

## An- und Abreise

- [x] [ ] Symbol im Seitentitel entfernen
- [x] [ ] Hinweis „Du bist …“ entfernen
  - Kommentar: Zentral über `whoami.js` umgesetzt; Profilwechsel bleibt unter „Mein Profil“ möglich.
- [x] [ ] „Notiz, z. B. komme nach der Arbeit“ in „Notiz (optional)“ umbenennen
- [x] [ ] „ETA (Ankunft ca.)“ in „Ankunft“ umbenennen
- [x] [ ] Kleine, falsche Symbole bei Fahrgemeinschaften entfernen
- [x] [ ] Zeitangaben nebeneinander darstellen
  - Notiz: Das gilt für alle Zeiten.
- [x] [ ] Kachelbeschreibung „Wann kommst/gehst du, plus Fahrgemeinschaften“ entfernen

## Durchsage

- [x] [ ] Hinweis „Du bist …“ entfernen
  - Kommentar: Zentral über `whoami.js` umgesetzt; Profilwechsel bleibt unter „Mein Profil“ möglich.
- [ ] [ ] Erklärung „Erscheint sofort auf allen offenen Geräten, auf dem Kiosk-Bildschirm und als Push-Benachrichtigung bei allen, die Push aktiviert haben.“ entfernen
  - Kommentar (Usermanagement): Zurückstellen. Empfängerkreis, Realtime-Rooms, Push und Kiosk
    werden in Phase 5 eventbezogen; der heutige Erklärungstext wäre dann fachlich überholt.
- [x] [ ] Symbol bei „Letzte Durchsagen“ entfernen

## Spieler

- Kommentar (Usermanagement): Den gesamten Abschnitt zurückstellen. Login/Claim statt manueller
  Identitätswahl, serverseitige Rollen, Spieler-Deaktivierung, Agent-Key-Sichtbarkeit und
  Key-Rotation sind ausdrücklich Bestandteil der Phasen 1 bis 4.

- [ ] [ ] Prüfen, ob „+ Spieler“ durch einen dynamischen Login ersetzt werden kann
  - Notiz: Ist das manuelle Hinzufügen wirklich notwendig?
- [ ] [ ] Berechtigung zum Löschen von Spielern absichern
  - Notiz: Das Löschen sollte nicht für jeden möglich sein.
- [ ] [ ] Prüfen, warum die Agent-API für jeden sichtbar ist
- [ ] [ ] Agent-Key und Einrichtungsanleitung aus der Spieleransicht entfernen
  - [ ] [ ] „Diesen Key in die Config des Agenten auf dem PC des Spielers eintragen.“ entfernen
  - [ ] [ ] Agent-Einstellungen stattdessen unter „Einstellungen“ unterbringen
  - Notiz: Die Spieleransicht ist für alle sichtbar und sollte keine Einstellungen enthalten.

## Auswertungen

- [x] [ ] Kacheltext auf „Awards und Statistiken“ kürzen
- [x] [ ] Symbol im Seitentitel „Auswertungen“ entfernen
- [ ] [ ] Zeitliche Eingrenzung aus den Auswertungen entfernen
  - [ ] [ ] Erklärung „Event wählen zeigt genau dessen Daten. Die Felder darüber grenzen innerhalb des Events optional weiter ein (z. B. nur Samstagnacht).“ entfernen, falls die Eingrenzung bestehen bleibt
  - Kommentar (Usermanagement): Zurückstellen. Sichtbare Events, Standardkontext und erlaubte
    `eventId`-Filter werden in Phase 5 neu festgelegt; die Filter-UI sollte danach vereinfacht werden.
- [x] [ ] Symbol bei „Beliebteste Spiele“ entfernen
- [x] [ ] Symbol bei „Awards“ entfernen
- [x] [ ] User in der Awards-Kachel ganz unten anzeigen
  - Notiz: Dadurch wirkt die Kachel einheitlicher.
- [x] [ ] Symbol bei „Längste Einzelsession pro Spiel“ entfernen
- [x] [ ] Statistik „Längste Einzelsession pro Spiel“ fachlich prüfen
  - Notiz: Bei mehreren Personen, die dasselbe Spiel spielen, hängt das Ergebnis faktisch davon ab, wer zuerst öffnet und zuletzt schließt.
- [x] [ ] „Mehrere Spiele gleichzeitig offen“ aus den Auswertungen entfernen oder als Achievement einordnen
  - Notiz: Das wirkt eher wie ein Achievement bzw. ein persönlicher Signature Move als wie eine relevante Auswertung.
- [x] [ ] „Belegung über die Zeit“ überarbeiten oder entfernen
  - [x] [ ] Achsenbeschriftungen ergänzen (durch Entfernen der Darstellung erledigt)
  - [x] [ ] Cover-Darstellung ermöglichen (durch Entfernen der Darstellung erledigt)
  - [x] [ ] Verhindern, dass beim Wechsel im Dropdown an den Seitenanfang gesprungen wird (Dropdown entfernt)
  - Notiz: Der aktuelle Stand wirkt unfertig.
- [x] [ ] „Wer hat wann was gespielt“ fachlich für den Einsatzzeitpunkt prüfen
  - Notiz: Die Information ist vermutlich eher nach der Veranstaltung interessant, nicht während der LAN.
- [x] [ ] Umfang der Auswertungsseite reduzieren
  - Notiz: Die Seite ist aktuell sehr lang; nach der Veranstaltung kann eine ausführliche Variante sinnvoll sein.

## Hall of Fame

- [x] [ ] Symbole aus den Titeln entfernen

## Admin

- Kommentar (Usermanagement): Den Abschnitt bis Phase 3 zurückstellen. Rollen-Gates,
  Test-User-Verwaltung, Deaktivierung und die Admin-Oberfläche werden dort gemeinsam überarbeitet.

- [ ] [ ] Symbole auf der Admin-Seite entfernen
- [ ] [ ] Erklärung „Kommen fertig eingerichtet: Platz im Sitzplan samt sichtbarer Monitore, Skill- und Bock-Werte pro Spiel, Spielzeit fürs aktive Event – zwei davon spielen gerade. Nur im Admin-Modus sichtbar.“ entfernen

## Mein Profil

- [x] [ ] Erklärung „Bild antippen zum Ändern. Gamer-Name muss über alle Spieler eindeutig sein. Der richtige Name ist optional und wird klein im Sitzplan angezeigt – hilft Neulingen, dich am Tisch zu finden.“ vollständig entfernen
- [ ] [ ] Symbole auf der Seite entfernen
- [x] [ ] Eingabefelder für „Richtiger Name“ und Gamer-Name nebeneinander darstellen
  - Notiz: Der vorhandene Platz reicht dafür aus und die Ansicht wirkt dadurch aufgeräumter.
- [ ] [ ] Agent-Bereich deutlich kürzer und zugänglicher formulieren
  - Notiz: Die Installation hat ohnehin eine Hemmschwelle; lange Texte werden auf der LAN wahrscheinlich nicht gelesen.
  - Kommentar (Usermanagement): Zurückstellen. Phase 3 macht den Agent-Key zum Geheimnis und
    beschränkt Anzeige, Download und Rotation auf den Inhaber beziehungsweise Admins.
- [x] [ ] Position des Buttons „Sitzplan ansehen“ überarbeiten
  - [x] [ ] Prüfen, ob der Button überhaupt benötigt wird
- [x] [ ] Erklärung zur Sichtbarkeit von Monitoren entfernen
  - Notiz: Die Überschrift „Sichtbare Monitore“ reicht als Erklärung.
- [x] [ ] Verlinkung zu den Spielen für Bock und Skill entfernen
  - Notiz: Der Weg zu den Spielen ist bereits kurz und eindeutig.
- [x] [ ] Abstand zwischen den oberen Kacheln unter „Meine Statistiken“ ergänzen
- [x] [ ] Symbole aus den Titeln unter „Meine Statistiken“ entfernen

## Einstellungen

- [x] [ ] Symbole aus den Titeln entfernen
- [ ] [ ] Erklärung „Legt das Event an, aber startet noch kein Tracking – das machst du danach gezielt über ‚Tracking starten‘.“ entfernen
  - Kommentar (Usermanagement): Zurückstellen. Event-Anlage und Tracking werden mit Rollen und
    Event-Sichtbarkeit in den Phasen 3 und 5 zu Admin-Funktionen.
- [ ] [ ] Erklärung zum Einladungslink und QR-Code entfernen
  - Notiz: „Diesen Link verschicken (oder den QR-Code zeigen/aushängen) …“
  - Kommentar (Usermanagement): Zurückstellen. Der geteilte Access-Token wird in Phase 4 durch
    Invite-/Claim-Codes mit eigener Verwaltungsoberfläche ersetzt.
- [ ] [ ] Erklärung zum gemeinsamen Bildschirm/Beamer entfernen
  - Notiz: „Für einen gemeinsamen Bildschirm/Beamer im Raum …“
  - Kommentar (Usermanagement): Zurückstellen. Phase 5 ersetzt den globalen Kiosk-Zugriff durch
    einen eventbezogenen Read-only-Token.
- [x] [ ] Symbole bei den Sitzplan-Titeln entfernen
- [x] [ ] „Backup laden“ in „Download Backup“ umbenennen

## Offene Entscheidungen und spätere Kommentare

- [ ] [ ] Feedback gemeinsam durchgehen und Prioritäten festlegen
- [ ] [ ] Offene Fragen und Alternativen entscheiden
- [x] [ ] Zwei getrennte Checkboxen für Umsetzung und deine Abnahme verwenden

### Notizen

<!-- Weitere Kommentare, Entscheidungen und Ergänzungen hier oder direkt unter den jeweiligen Punkten eintragen. -->
