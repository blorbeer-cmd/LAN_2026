# Feedback – RespawnHQ

Strukturierte Feedbackliste zur gemeinsamen Durchsicht und späteren Abarbeitung.

## Verwendung

- `[ ]` offen
- `[x]` umgesetzt und für gut befunden
- Kommentare und Entscheidungen direkt unter dem jeweiligen Punkt ergänzen
- Punkte mit einer offenen Frage zuerst gemeinsam entscheiden
- `Kommentar (Usermanagement)` kennzeichnet Punkte, die bis zur Umsetzung des Konzepts in
  `docs/KONZEPT-USER-MANAGEMENT.md` bewusst nicht angefasst werden.

---

## Generell

- [ ] Produktname von „RespawnHQ“ zu „Respawn“ ändern
  - [ ] Text nicht kursiv darstellen
  - [ ] Repo und alle Referenzen zu RespawnHQ ebenfalls umbenennen
- [ ] Kreuz zum Schließen der Meldungen reparieren; aktuell reagiert es nicht
- [ ] Symbole in den Untermenüs unter „Mehr“ entfernen und dort nur den Titel anzeigen
  - [ ] Darstellung über alle Untermenüs konsistent machen
- [ ] Symbole aus den bunt gestalteten Buttons generell entfernen
  - Notiz: Die Buttons wirken dadurch cleaner und einheitlicher.
- [ ] Gekürzte, aber weiterhin hilfreiche Erklärtexte über ein einheitliches Info-Tooltip anbieten
  - [ ] Infosymbol direkt neben dem zugehörigen Titel oder Feldnamen anzeigen
  - [ ] Tooltip optisch an das bestehende Design-System anpassen
  - [ ] Bedienung per Maus, Tastatur und Touch sicherstellen
  - Notiz: Beispiel „Captain Draft“: sichtbar bleibt „2–4 Captains wählen“; das Infosymbol erklärt
    „2–4 Captains antippen – sie picken dann abwechselnd live aus den übrigen angehakten Spielern.
    Alle können auf ihrem Handy zusehen.“

## Home

- [ ] Meldungsbereich vereinheitlichen und grundsätzlich nur die neueste Meldung anzeigen
  - Notiz: Aktuell erscheinen unter anderem Admin-Modus, „Neue Sammelbestellung“ und die Sammelbestellung selbst mehrfach bzw. in unterschiedlichen Stilen.
  - Kommentar (Usermanagement): Die rein visuelle Doppelungsprüfung darf im UI-PR stattfinden;
    eine neue personenbezogene Mitteilungslogik bleibt wegen Session-Identität, Push-Neubindung und
    Event-Scoping bis zu den Phasen 2 und 5 zurückgestellt.
- [ ] Prüfen, warum der Status immer „Offline“ ist
  - [ ] Agent-Anbindung prüfen
  - [ ] Falls der Status nicht zuverlässig über den Browser ermittelt werden kann: Statusanzeige entfernen
- [ ] „Aktuell“ nach oben setzen
- [ ] „Dein Status“ nach unten verschieben, direkt über die anderen Statusinformationen
- [ ] „Aktuell“ für mehrere nebeneinanderstehende Kacheln vorbereiten
- [ ] „Ganze Rangliste“ in „Gesamte Rangliste“ umbenennen
- [ ] Sitzplan mit einem Titel oben links versehen, analog zu Rangliste und Status
- [ ] „Mitteilungen“ aus dem unteren Seitenbereich herauslösen
  - [ ] Glocken-Symbol in der oberen Leiste bei Profil, Einstellungen und GitHub ergänzen
  - [ ] Mitteilungen dort als Liste anzeigen
  - [ ] Mitteilungen als gelesen markieren können
  - [ ] Mitteilungen entfernen können
  - Kommentar (Usermanagement): Zurückstellen. Gelesen-/Löschstatus, Push-Abos und Sichtbarkeit
    werden mit fester Identität und Event-Scoping in den Phasen 2 und 5 neu angebunden.

## Turniere

- [ ] Spielerauswahl beim Erstellen eines Turniers in 2–4 Kachelbreiten nebeneinander darstellen
  - Notiz: Dadurch wird weniger gescrollt und die Auswahl übersichtlicher.
- [ ] Button „Alle markieren“ neben „Anzahl Teams“ ergänzen
- [ ] Button „Auswahl aufheben“ neben „Anzahl Teams“ ergänzen
- [ ] „Sitznachbarn bevorzugt ins selbe Team losen“ in „Sitznachbarn zusammen“ umbenennen
- [ ] Symbole bei den Checkboxen entfernen
  - [ ] Sitznachbarn
  - [ ] Hin- und Rückspiel
  - [ ] Ergebnisse mit Punktestand
- [ ] „Hin- und Rückspiele (jeder spielt zweimal gegen jeden)“ in „Hin- und Rückspiel“ umbenennen
- [ ] „Ergebnisse mit Punktestand erfassen (statt nur Sieg/Niederlage)“ in „Ergebnisse inkl. Punktestand“ umbenennen

## Teams

- [ ] Aufbau und allgemeines Feedback aus dem Bereich „Turniere“ auch auf „Teams“ übertragen
- [ ] Hinweis „Anzahl Teams leer lassen für automatisch (Standard: 2)“ entfernen
- [ ] Stattdessen standardmäßig die Zahl 2 eintragen
- [ ] „Oder: Captain-Draft“ in „Captain Draft“ umbenennen
  - [ ] Symbol entfernen
  - [ ] „Oder“ entfernen
- [ ] „2–4 Captains antippen – sie picken dann abwechselnd live aus den übrigen angehakten Spielern. Alle können auf ihrem Handy zusehen.“ auf „2–4 Captains wählen“ kürzen
- [ ] „Kraft starten“ mittig unter „Teams auslosen“ ausrichten
- [ ] „Kraft starten“ ab mindestens zwei ausgewählten Personen visuell wie „Teams auslosen“ gestalten
- [ ] Symbol bei „Team-Historie“ entfernen
- [ ] „Team-Historie“ standardmäßig einklappen
  - Notiz: Die Historie kann schnell sehr lang werden.

## Vote

- [ ] Hinweis „Du bist …“ entfernen
  - Kommentar (Usermanagement): Zurückstellen. `whoami.js` und damit dieser Hinweis entfallen in
    Phase 2 ohnehin zugunsten der Session-Identität.
- [ ] Symbol bei „Neue Abstimmung starten“ entfernen
- [ ] Buttons „Bewertung abschicken“ und „Beenden und Gewinner küren“ sauber aufeinander ausrichten
- [ ] Beschreibung kürzen auf: „Punkte frei verteilen, höchste Summe gewinnt.“
  - [ ] Symbol entfernen
  - [ ] Einmalige Gender-Formulierung in diesem Text entfernen
- [ ] Prüfen, ob grundsätzlich zwei Spiele nebeneinander dargestellt werden können
  - Notiz: Der Platz dafür scheint vorhanden zu sein.
- [ ] „Vote-Historie“ standardmäßig einklappen
- [ ] Symbol in der Überschrift der „Vote-Historie“ ergänzen
- [ ] Erklärung „Antippen für die genaue Punkteverteilung dieser Runde.“ entfernen

## Rang

- [ ] Symbol bei „Spielzeit“ entfernen
- [ ] „Spielzeit pro Spiel (alle zusammen)“ in „Spielzeit pro Spiel“ umbenennen
- [ ] Symbol bei „Spielzeit pro Spiel“ entfernen
- [ ] Beim Eintragen eines neuen Ergebnisses „Frei für alle (kein Team, jeder für sich)“ in „Frei-für-alle“ umbenennen
  - [ ] Symbol entfernen
- [ ] „Werte / Platzierung …“ in „Werte / Platzierung eintragen“ umbenennen
  - [ ] Symbol entfernen
- [ ] Spieler-Zuordnung ausrichten
  - Notiz: Die Dropdown-Boxen sind aktuell je nach Länge des Spielernamens unterschiedlich eingerückt.

## Mehr

- [ ] Anordnung der Kacheln festlegen
  - [ ] Entweder fachlich sinnvoll sortieren
  - [ ] Oder alphabetisch sortieren

## Info-Board

- [ ] Prüfen, ob einzelne Inhalte größer dargestellt werden sollten
- [ ] Symbol innerhalb des Info-Boards entfernen

## Spiele

- [ ] Symbol im Seitentitel „Spiele“ entfernen
  - Notiz: Ansonsten ist die Seite aus Sicht des Feedbacks fertig.

## Essen

- [ ] Symbol im Seitentitel entfernen
- [ ] „Essen bestellen“ in „Essen“ umbenennen
- [ ] Hinweis „Du bist …“ entfernen
  - Kommentar (Usermanagement): Zurückstellen. `whoami.js` und damit dieser Hinweis entfallen in
    Phase 2 ohnehin zugunsten der Session-Identität.
- [ ] „+ Info & Link“ in „Info“ umbenennen
- [ ] Bezeichnungen in den Infos vereinfachen
  - [ ] „Geht raus um“ in „Versand“ umbenennen
  - [ ] „Link zur Karte / Lieferdienst“ in „Link“ umbenennen
  - [ ] Hinweis „Leer lassen entfernt das jeweilige Feld.“ entfernen
- [ ] Für die Datumsauswahl dasselbe Widget wie bei An- und Abreise verwenden

## Arcade

- [ ] Hinweis „Du bist …“ entfernen
  - Kommentar (Usermanagement): Zurückstellen. `whoami.js` und damit dieser Hinweis entfallen in
    Phase 2 ohnehin zugunsten der Session-Identität.
- [ ] Symbol beim Seitentitel „Spiele“ entfernen
- [ ] Beschreibung der Kachel „… aktuell mit Mehrspieler-Gaming-Quiz.“ in „Minigame-Lobbies“ ändern
  - Notiz: Die Anordnung wirkt grundsätzlich gut; die Spiele selbst wurden zuletzt nicht erneut geprüft.

## An- und Abreise

- [ ] Symbol im Seitentitel entfernen
- [ ] Hinweis „Du bist …“ entfernen
  - Kommentar (Usermanagement): Zurückstellen. `whoami.js` und damit dieser Hinweis entfallen in
    Phase 2 ohnehin zugunsten der Session-Identität.
- [ ] „Notiz, z. B. komme nach der Arbeit“ in „Notiz (optional)“ umbenennen
- [ ] „ETA (Ankunft ca.)“ in „Ankunft“ umbenennen
- [ ] Kleine, falsche Symbole bei Fahrgemeinschaften entfernen
- [ ] Zeitangaben nebeneinander darstellen
  - Notiz: Das gilt für alle Zeiten.
- [ ] Kachelbeschreibung „Wann kommst/gehst du, plus Fahrgemeinschaften“ entfernen

## Durchsage

- [ ] Hinweis „Du bist …“ entfernen
  - Kommentar (Usermanagement): Zurückstellen. `whoami.js` und damit dieser Hinweis entfallen in
    Phase 2 ohnehin zugunsten der Session-Identität.
- [ ] Erklärung „Erscheint sofort auf allen offenen Geräten, auf dem Kiosk-Bildschirm und als Push-Benachrichtigung bei allen, die Push aktiviert haben.“ entfernen
  - Kommentar (Usermanagement): Zurückstellen. Empfängerkreis, Realtime-Rooms, Push und Kiosk
    werden in Phase 5 eventbezogen; der heutige Erklärungstext wäre dann fachlich überholt.
- [ ] Symbol bei „Letzte Durchsagen“ entfernen

## Spieler

- Kommentar (Usermanagement): Den gesamten Abschnitt zurückstellen. Login/Claim statt manueller
  Identitätswahl, serverseitige Rollen, Spieler-Deaktivierung, Agent-Key-Sichtbarkeit und
  Key-Rotation sind ausdrücklich Bestandteil der Phasen 1 bis 4.

- [ ] Prüfen, ob „+ Spieler“ durch einen dynamischen Login ersetzt werden kann
  - Notiz: Ist das manuelle Hinzufügen wirklich notwendig?
- [ ] Berechtigung zum Löschen von Spielern absichern
  - Notiz: Das Löschen sollte nicht für jeden möglich sein.
- [ ] Prüfen, warum die Agent-API für jeden sichtbar ist
- [ ] Agent-Key und Einrichtungsanleitung aus der Spieleransicht entfernen
  - [ ] „Diesen Key in die Config des Agenten auf dem PC des Spielers eintragen.“ entfernen
  - [ ] Agent-Einstellungen stattdessen unter „Einstellungen“ unterbringen
  - Notiz: Die Spieleransicht ist für alle sichtbar und sollte keine Einstellungen enthalten.

## Auswertungen

- [ ] Kacheltext auf „Awards und Statistiken“ kürzen
- [ ] Symbol im Seitentitel „Auswertungen“ entfernen
- [ ] Zeitliche Eingrenzung aus den Auswertungen entfernen
  - [ ] Erklärung „Event wählen zeigt genau dessen Daten. Die Felder darüber grenzen innerhalb des Events optional weiter ein (z. B. nur Samstagnacht).“ entfernen, falls die Eingrenzung bestehen bleibt
  - Kommentar (Usermanagement): Zurückstellen. Sichtbare Events, Standardkontext und erlaubte
    `eventId`-Filter werden in Phase 5 neu festgelegt; die Filter-UI sollte danach vereinfacht werden.
- [ ] Symbol bei „Beliebteste Spiele“ entfernen
- [ ] Symbol bei „Awards“ entfernen
- [ ] User in der Awards-Kachel ganz unten anzeigen
  - Notiz: Dadurch wirkt die Kachel einheitlicher.
- [ ] Symbol bei „Längste Einzelsession pro Spiel“ entfernen
- [ ] Statistik „Längste Einzelsession pro Spiel“ fachlich prüfen
  - Notiz: Bei mehreren Personen, die dasselbe Spiel spielen, hängt das Ergebnis faktisch davon ab, wer zuerst öffnet und zuletzt schließt.
- [ ] „Mehrere Spiele gleichzeitig offen“ aus den Auswertungen entfernen oder als Achievement einordnen
  - Notiz: Das wirkt eher wie ein Achievement bzw. ein persönlicher Signature Move als wie eine relevante Auswertung.
- [ ] „Belegung über die Zeit“ überarbeiten oder entfernen
  - [ ] Achsenbeschriftungen ergänzen
  - [ ] Cover-Darstellung ermöglichen
  - [ ] Verhindern, dass beim Wechsel im Dropdown an den Seitenanfang gesprungen wird
  - Notiz: Der aktuelle Stand wirkt unfertig.
- [ ] „Wer hat wann was gespielt“ fachlich für den Einsatzzeitpunkt prüfen
  - Notiz: Die Information ist vermutlich eher nach der Veranstaltung interessant, nicht während der LAN.
- [ ] Umfang der Auswertungsseite reduzieren
  - Notiz: Die Seite ist aktuell sehr lang; nach der Veranstaltung kann eine ausführliche Variante sinnvoll sein.

## Hall of Fame

- [ ] Symbole aus den Titeln entfernen

## Admin

- Kommentar (Usermanagement): Den Abschnitt bis Phase 3 zurückstellen. Rollen-Gates,
  Test-User-Verwaltung, Deaktivierung und die Admin-Oberfläche werden dort gemeinsam überarbeitet.

- [ ] Symbole auf der Admin-Seite entfernen
- [ ] Erklärung „Kommen fertig eingerichtet: Platz im Sitzplan samt sichtbarer Monitore, Skill- und Bock-Werte pro Spiel, Spielzeit fürs aktive Event – zwei davon spielen gerade. Nur im Admin-Modus sichtbar.“ entfernen

## Mein Profil

- [ ] Erklärung „Bild antippen zum Ändern. Gamer-Name muss über alle Spieler eindeutig sein. Der richtige Name ist optional und wird klein im Sitzplan angezeigt – hilft Neulingen, dich am Tisch zu finden.“ vollständig entfernen
- [ ] Symbole auf der Seite entfernen
- [ ] Eingabefelder für „Richtiger Name“ und Gamer-Name nebeneinander darstellen
  - Notiz: Der vorhandene Platz reicht dafür aus und die Ansicht wirkt dadurch aufgeräumter.
- [ ] Agent-Bereich deutlich kürzer und zugänglicher formulieren
  - Notiz: Die Installation hat ohnehin eine Hemmschwelle; lange Texte werden auf der LAN wahrscheinlich nicht gelesen.
  - Kommentar (Usermanagement): Zurückstellen. Phase 3 macht den Agent-Key zum Geheimnis und
    beschränkt Anzeige, Download und Rotation auf den Inhaber beziehungsweise Admins.
- [ ] Position des Buttons „Sitzplan ansehen“ überarbeiten
  - [ ] Prüfen, ob der Button überhaupt benötigt wird
- [ ] Erklärung zur Sichtbarkeit von Monitoren entfernen
  - Notiz: Die Überschrift „Sichtbare Monitore“ reicht als Erklärung.
- [ ] Verlinkung zu den Spielen für Bock und Skill entfernen
  - Notiz: Der Weg zu den Spielen ist bereits kurz und eindeutig.
- [ ] Abstand zwischen den oberen Kacheln unter „Meine Statistiken“ ergänzen
- [ ] Symbole aus den Titeln unter „Meine Statistiken“ entfernen

## Einstellungen

- [ ] Symbole aus den Titeln entfernen
- [ ] Erklärung „Legt das Event an, aber startet noch kein Tracking – das machst du danach gezielt über ‚Tracking starten‘.“ entfernen
  - Kommentar (Usermanagement): Zurückstellen. Event-Anlage und Tracking werden mit Rollen und
    Event-Sichtbarkeit in den Phasen 3 und 5 zu Admin-Funktionen.
- [ ] Erklärung zum Einladungslink und QR-Code entfernen
  - Notiz: „Diesen Link verschicken (oder den QR-Code zeigen/aushängen) …“
  - Kommentar (Usermanagement): Zurückstellen. Der geteilte Access-Token wird in Phase 4 durch
    Invite-/Claim-Codes mit eigener Verwaltungsoberfläche ersetzt.
- [ ] Erklärung zum gemeinsamen Bildschirm/Beamer entfernen
  - Notiz: „Für einen gemeinsamen Bildschirm/Beamer im Raum …“
  - Kommentar (Usermanagement): Zurückstellen. Phase 5 ersetzt den globalen Kiosk-Zugriff durch
    einen eventbezogenen Read-only-Token.
- [ ] Symbole bei den Sitzplan-Titeln entfernen
- [ ] „Backup laden“ in „Download Backup“ umbenennen

## Offene Entscheidungen und spätere Kommentare

- [ ] Feedback gemeinsam durchgehen und Prioritäten festlegen
- [ ] Offene Fragen und Alternativen entscheiden
- [ ] Nach Umsetzung jeden Punkt erst nach gemeinsamer Abnahme mit `[x]` markieren

### Notizen

<!-- Weitere Kommentare, Entscheidungen und Ergänzungen hier oder direkt unter den jeweiligen Punkten eintragen. -->
