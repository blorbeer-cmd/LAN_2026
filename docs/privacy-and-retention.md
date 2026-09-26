# Datenschutz- und Aufbewahrungskonzept

Stand: 19. September 2026. Dieses Dokument beschreibt die technische Umsetzung. Es ist keine
Rechtsberatung und behauptet keine pauschale DSGVO-Konformität. Verantwortliche Stelle,
Rechtsgrundlagen, gesetzliche Aufbewahrungspflichten und eingesetzte Dienstleister muss der
Betreiber für seine konkrete Installation festlegen.

## Leitlinien

- Respawn erhebt nur Daten, die ein sichtbares Produktmerkmal oder den sicheren Betrieb tragen.
- Spielaktivität wird nur für das aktuell gewählte, laufende Event mit bestätigter Teilnahme,
  aktiviertem Tracking und gültiger, versionierter Einwilligung verarbeitet.
- Der Windows-Agent erhält ohne diesen Kontext keine Prozess-Allowlist. Prozessnamen werden dann
  weder übertragen noch gespeichert oder in der Admin-Diagnose angezeigt.
- Einwilligung und Widerruf sind im Konto erreichbar. Ein Widerruf beendet die laufende Erfassung
  sofort; vergangene Rohdaten unterliegen Löschung und Aufbewahrung.
- Persönlicher Export und Kontolöschung sind Selbstbedienungsfunktionen nach erneuter Anmeldung.
  Wiederverwendbare Geheimnisse wie Sitzungstoken, API-Schlüssel, Passwort-Hashes und Push-Schlüssel
  sind nie Teil des Exports.

Bei der Kontolöschung entfernt Respawn außerdem Empfängerlisten und andere strukturierte
Kontobezüge aus der Push-Historie sowie Sitzplatzzuordnungen, IDs, Namen, Profilbilder oder weitere
Profil-Snapshots in Match-, Team-, Arcade- und Protokollhistorien. Scribble-Zeichnungen bleiben als
anonymer Spielinhalt ohne Kontobezug erhalten. Eigene Nachrichten und
sonstige eigene Freitexte werden gelöscht. Erwähnungen in frei formulierten Texten anderer Personen
können nicht zuverlässig als Bezug erkannt werden; solche begründeten Einzelfälle muss die Orga nach
einem Betroffenenhinweis prüfen. Diese Grenze wird nicht als Anonymisierung ausgegeben.

Selbstbedienung und adminseitiges Löschen nutzen denselben Löschpfad und damit auch dieselben
Voraussetzungen: unübertragene Admin-/Ownerrolle, bestätigte Event-Zahlung, selbst angelegte
Sammelbestellungen oder Fahrgemeinschaften, offene To-dos, ein laufender Captain-Draft und eine
laufende Jam-Session blockieren die Löschung. Das gilt bewusst auch für Admins, damit ein fremder
Fachvorgang nicht unbemerkt mitgelöscht wird; die Orga klärt den genannten Vorgang zuerst in der
jeweiligen Ansicht und löscht danach. Die Meldung benennt den konkreten Grund und ist für die
Selbstlöschung und den Adminfall getrennt formuliert.

## Dateninventar

| Datenkategorie | Zweck | Sichtbarkeit | Erhebung | Technische Aufbewahrung | Löschpfad |
| --- | --- | --- | --- | --- | --- |
| Konto, Profil, Community-Rolle | Anmeldung, Anzeige, Berechtigung | eigenes Konto; Profilfelder für Community-Mitglieder; Rollen für Admins | Registrierung und Profilpflege | bis Kontolöschung | Konto > Datenschutz; blockiert nur bei unübertragener Rolle oder offenem Fachvorgang |
| Event-Teilnahme und Zahlungsstatus | Planung und Abrechnung | betroffene Person und Orga | Einladung, Zu-/Absage, Orga-Bestätigung | bis Kontolöschung; bestätigte Zahlung muss zuvor fachlich geklärt werden | Teilnahme/Zahlung zurücksetzen, dann Konto löschen |
| Tracking-Einwilligung | Nachweis der freiwilligen Aktivitätserfassung | betroffene Person und technisch berechtigte Orga | ausdrückliche Checkbox; Zeitpunkt, Quelle, Zweck und Textversion | Historie bis Kontolöschung | Widerruf sofort; Historie mit Kontolöschung |
| Agent-Erreichbarkeit und Spielaktivität | Live-Status, Spielzeit, Auswertung, Fehlersuche | eigener Status; Event-/Adminansichten im jeweiligen Umfang | Windows-Agent nur bei gültigem Event-Kontext | Diagnose standardmäßig 7 Tage; beendete Rohsitzungen abgeschlossener Events 730 Tage, wenn Bereinigung aktiviert | Widerruf stoppt neue Erfassung und leert den zuletzt gespeicherten Prozess-Snapshot der Diagnose, sobald kein gültiger Kontext mehr besteht; Kontolöschung oder aktivierte Bereinigung entfernt die übrigen Rohdaten |
| Skills, Vorlieben und Abstimmungen | Spielauswahl und Matchmaking | Community-/Eventansichten | Eingabe durch Mitglied | bis Kontolöschung | einzelne Eingaben in der App; vollständig mit Kontolöschung |
| Essen, Anreise, Fahrgemeinschaften, Checklisten | Event-Organisation | Eventteilnehmer und Orga | Eingabe durch Mitglieder/Orga | fachlicher Vorgang; kein automatischer Zeitraum | offene oder verantwortete Vorgänge zuerst abschließen/übergeben; danach Kontolöschung |
| Nachrichten, Push-Historie und Feedback | Kommunikation und Support | Empfänger, Absender und Orga je Funktion | Eingabe/Ereignis; Push-Abo durch Browser | erledigte/abgelaufene Push-Historie standardmäßig 90 Tage, beendete Rundrufe 180 Tage und erledigtes Feedback 365 Tage bei aktivierter Bereinigung | Ausblenden/auflösen; Kontolöschung entfernt eigene Inhalte und Empfängerbezüge |
| Browser-Sitzungen, Agent-Schlüssel, Push-Abo-Schlüssel | Authentifizierung und Zustellung | nur technische Verarbeitung | Anmeldung, Agent-Einrichtung, Browser-Push | abgelaufene Sitzungen bei aktivierter Bereinigung; übrige bis Widerruf/Kontolöschung | Abmelden/Push deaktivieren; Kontolöschung widerruft alles |
| Admin-Audit | Sicherheits- und Änderungsnachweis | Admins | administrative Änderungen | technischer Vorschlag 365 Tage bei aktivierter Bereinigung | automatisierte Bereinigung; hashbasierte Löschbelege sind für Restore-Schutz ausgenommen |
| SQLite-Backups | Wiederherstellung nach Ausfall | Betreiber | vor Tracking-Aktivierung und manuell | Anzahl standardmäßig 20; externe Kopien nach Betreiberregel | Rotation plus Löschabgleich vor jedem Wiederanlauf |

Die genannten Tage sind technische Ausgangswerte, keine gesetzlichen Fristen. Offene oder laufende
Vorgänge werden von der automatischen Bereinigung ausgenommen. Jede Bereinigungsrunde ist auf eine
konfigurierbare Anzahl Datensätze begrenzt und kann gefahrlos wiederholt werden.

## Einwilligung und Altbestand

Der aktuelle Trackingtext hat eine feste Version. Der Server akzeptiert eine neue Einwilligung nur,
wenn Browser und Server dieselbe Version verwenden. Ändert sich der Text, muss erneut aktiv
eingewilligt werden. Vorhandene Einwilligungen aus älteren Versionen bleiben als unveränderter,
unversionierter Verlauf erhalten; sie werden nicht stillschweigend in eine aktuelle Einwilligung
umgedeutet und aktivieren keine Erfassung. Ein Widerruf bleibt jederzeit ohne Textversionsprüfung
möglich. Damit eine solche Altzeile nicht unwiderrufbar im Bestand liegt, führt die
Datenschutzansicht sie getrennt unter „Frühere Event-Einwilligungen“ beziehungsweise „Alte
Zustimmung“ auf; dort widerrufene Zeilen verschwinden aus der Liste und erscheinen im
persönlichen Export mit gesetztem Widerrufszeitpunkt.

Wer nicht bei jedem neuen Event erneut entscheiden möchte, kann im Profil eine stehende
Vorab-Einwilligung setzen. Sie merkt sich die Textversion, unter der sie erteilt wurde, und wirkt
nur für genau diese Fassung: Sobald der Einwilligungstext sich ändert, greift sie nicht mehr und es
wird wieder aktiv gefragt. Sie füllt ausschließlich Lücken — für ein Event, zu dem bereits eine
Entscheidung vorliegt, ändert sie nichts, und ein einzelner Widerruf bleibt bestehen. Eingetragen
wird sie in dem Moment, in dem ein Bereich tatsächlich trackbar wird: wenn die Orga das Tracking
startet oder wenn jemand ein bereits laufendes Tracking-Event zusagt. In beiden Fällen entsteht
eine reguläre Einwilligungszeile mit Zweck und Textversion, kein stillschweigender Sonderfall.

Sie gilt auch für eine freigeschaltete Gruppe. Das ist bewusst so, muss aber klar sein: Eine Gruppe
ist der eine trackbare Bereich ohne Endzeitpunkt, die Erfassung läuft dort also bis zum Widerruf
statt bis zum Eventende. Die Profilbeschriftung nennt Gruppen ausdrücklich; der benachbarte Tooltip
erklärt diesen Unterschied. Wer das nicht will, lässt die Vorab-Einwilligung aus und entscheidet weiter je
Bereich einzeln; ein Widerruf der einzelnen Gruppenzeile bleibt jederzeit möglich.

## Welche Bereiche überhaupt trackbar sind

Nicht jeder Arbeitsbereich kann Tracking erhalten:

- Der dauerhaft geöffnete Bereich „Allgemein“ ist davon ausgenommen. Er hat keinen Zeitraum, den
  eine Orga startet und beendet, also gäbe es auch keinen abgrenzbaren Vorgang, in den jemand
  einwilligen könnte. Eine ältere Installation, in der das Tracking dort einmal gestartet wurde,
  wird durch Migration 110 zurückgesetzt.
- Ein allgemeines Event (Feier, Reise, Ausflug, Workshop) ist ebenfalls ausgenommen; Spielaktivität
  ist nicht sein Zweck, und sein Funktionsvorschlag enthält das Tracking-Modul nicht. Migration 110
  schaltet Tracking bei älteren allgemeinen Events ab und schließt noch offene Tracking-Sitzungen.
- Eine Gruppe ist der eine dauerhafte Bereich, der Tracking erhalten kann. Sie ist bewusst
  permanent geöffnet statt zufällig ohne Datum, deshalb zählt ihr fehlender Startzeitpunkt als
„läuft“. Auch dort gilt die übliche Zweistufigkeit: Die Orga schaltet das Tracking für die Gruppe
  frei, und danach entscheidet jedes Mitglied für sich per Einwilligung — entweder direkt oder über
  die oben beschriebene stehende Vorab-Einwilligung, die genau diese Entscheidung vorwegnimmt.
- Eine LAN-Party mit festem Zeitraum bleibt der Regelfall.

## Aufbewahrung aktivieren

Die Bereinigung ist standardmäßig aus. Ein Admin prüft zuerst angemeldet
`GET /api/privacy/retention-preview`. Die Antwort nennt je Regel Kandidatenzahl, Schutzbedingung und
Frist, ohne Daten zu verändern. Erst nach dokumentierter Betreiberentscheidung wird aktiviert:

```dotenv
PRIVACY_RETENTION_ENABLED=1
PRIVACY_RETENTION_BATCH_SIZE=500
PRIVACY_RETENTION_AGENT_DIAGNOSTICS_DAYS=7
PRIVACY_RETENTION_RESOLVED_PUSH_DAYS=90
PRIVACY_RETENTION_ENDED_BROADCAST_DAYS=180
PRIVACY_RETENTION_RESOLVED_FEEDBACK_DAYS=365
PRIVACY_RETENTION_AUDIT_DAYS=365
PRIVACY_RETENTION_PLAY_SESSIONS_DAYS=730
```

Nach dem Neustart läuft sofort eine begrenzte Runde, danach täglich. Vor einer Friständerung erneut
die Vorschau prüfen. Die Löschbelege für Backup-Abgleiche werden bewusst nicht von der Audit-Regel
erfasst; sie dürfen erst entfernt werden, wenn kein älteres Backup mehr wiederhergestellt werden kann.
Zusätzlich schreibt jede Kontolöschung einen hashbasierten Beleg in das append-only Ledger aus
`PRIVACY_DELETION_LEDGER_FILE`. Ohne gesetzten Pfad liegt das Ledger neben der SQLite-Datei: Das
überlebt das Zurückspielen eines Backups, also genau den dokumentierten Restore-Ablauf, aber nicht
den Verlust des ganzen Datenverzeichnisses. Der Betreiber legt das Ziel deshalb auf unabhängig
gesicherten Speicher; fehlt der Pfad, warnt der Produktionsstart deutlich, bricht aber eine
laufende Installation nicht ab. Kann das Ledger nicht synchron geschrieben werden, wird die
Kontolöschung ohne Datenänderung abgebrochen. Im Docker-Betrieb sind dafür
`PRIVACY_DELETION_LEDGER_DIR` und `PRIVACY_DELETION_LEDGER_FILE` gemeinsam zu setzen; die
konkreten Pfade und Rechte stehen in [`server/OPERATIONS.md`](../server/OPERATIONS.md).

## Betreiberentscheidungen vor Produktion

Der Betreiber dokumentiert mindestens:

- verantwortliche Stelle und Kontakt sowie einen Prozess für Betroffenenanfragen;
- Rechtsgrundlage je notwendiger Verarbeitung; Tracking bleibt davon getrennt freiwillig;
- tatsächliche Aufbewahrungsfristen einschließlich steuerlicher oder vertraglicher Pflichten;
- Hosting-, Push-, E-Mail- und sonstige Empfänger/Auftragsverarbeiter;
- Zugriffsrollen, externes Backup-Ziel, Löschbeleg-Sicherung und Restore-Probe;
- Umgang mit Minderjährigen, falls diese teilnehmen können.

## Offizielle Grundlagen

Geprüft am 19. September 2026:

- [DSGVO, insbesondere Art. 5, 7, 15 und 17 (EUR-Lex)](https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32016R0679)
- [EDSA-Leitlinien 05/2020 zur Einwilligung](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_en)
- [EDSA: personenbezogene Daten rechtmäßig verarbeiten](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en)
- [EDSA: Rechte betroffener Personen](https://www.edpb.europa.eu/sme-data-protection-guide/respect-individuals-rights_en)
