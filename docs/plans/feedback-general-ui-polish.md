# Plan: Allgemeines Feedback als lokaler UI-PR

## Ziel und PR-Zuschnitt

Der lokale PR setzt das umsetzungsreife Feedback aus `docs/FEEDBACK-GENERELL.md` als zusammenhängenden
UI-Polish-Pass um. Änderungen an Identität, Login, Rollen, Spieler-Lebenszyklus, Agent-Key-Rechten,
Einladungen und Event-Sichtbarkeit bleiben ausdrücklich außen vor. Der personenbezogene
Meldungsbereich wurde auf späteren ausdrücklichen Wunsch bereits auf Basis der lokal gewählten
Spieleridentität umgesetzt; ein künftiges Usermanagement muss diese vorläufige Bindung auf die
authentifizierte Session umstellen. Die übrigen Punkte mit `Kommentar (Usermanagement)` gehören in
die Phasen aus `docs/KONZEPT-USER-MANAGEMENT.md`.

Vorgeschlagener Arbeitstitel: **Refine general UI copy, layouts and contextual help**.

Der PR darf mehrere kleine Commits enthalten und bleibt bis zur Abnahme ein lokaler Arbeitsbranch.
Der inzwischen ausdrücklich beauftragte vollständige Produkt- und Repository-Rename wird als
abschließendes Arbeitspaket umgesetzt; ein Push oder Merge ist damit weiterhin nicht beauftragt.

## Leitentscheidungen

1. Erklärtexte werden nicht pauschal versteckt. Ein Tooltip bleibt nur dort erhalten, wo der
   entfernte Text eine nicht offensichtliche Bedienregel erklärt. Reine Wiederholungen entfallen.
2. Das sogenannte Tooltip ist ein touch-tauglicher Info-Popover: ein Lucide-Infosymbol neben Titel
   oder Feldname, kein nur per Hover erreichbares natives `title`-Attribut. Das Infosymbol steht
   immer direkt rechts neben dem sichtbaren Text, den es erklärt.
3. Seitentitel und farbige Aktionsbuttons werden entsprechend der Feedbackliste von dekorativen
   Symbolen befreit. Status-, Warn- und rein ikonische Bedienelemente behalten notwendige Symbole.
4. Die Kacheln unter „Mehr“ werden alphabetisch sortiert. Das schafft eine objektive, dauerhaft
   stabile Reihenfolge; die fachliche Gruppierung ist bei nur zehn Einträgen nicht eindeutig.
5. Historien werden mit nativen `<details>`/`<summary>` standardmäßig eingeklappt. Dadurch bleiben
   Tastaturbedienung und Semantik ohne eigene Zustandslogik erhalten.
6. Die bestehende Implementierung der „Längsten Einzelsession pro Spiel“ wählt bereits die längste
   einzelne Spieler-Session und hängt nicht davon ab, wer ein Spiel zuerst öffnet oder zuletzt
   schließt. Der PR macht diese Bedeutung im Titel eindeutig und sichert sie mit einem Test ab.
7. „Belegung über die Zeit“ und „Mehrere Spiele gleichzeitig offen“ verschwinden aus der normalen
   Auswertungsansicht. Das Session-Protokoll bleibt für die Nachbereitung in einem eingeklappten
   Detailbereich erhalten. Die APIs werden in diesem UI-PR nicht vorschnell gelöscht.

## Arbeitspakete

### 1. Ausgangszustand und regressionssichere Basis

- Vor der Änderung die in der Feedbackliste genannten Pfade auf aktuellem Phone- und Laptop-Viewport
  reproduzieren; die Liste ist teilweise älter als der jetzige Code.
- Das Schließen der neuesten Kopfzeilen-Mitteilung in `notificationBanner.js` gezielt prüfen.
  Die Funktion und ein E2E-Pfad existieren bereits; nur bei reproduzierbarem Fehler Ursache beheben
  und den Test auf den tatsächlichen Fehlerfall erweitern.
- Den immer „Offline“ wirkenden Status mit vorhandenem Agent-Heartbeat und Live-State prüfen. Dieser
  Diagnosepunkt ist kein Anlass, im UI-PR Authentifizierung oder Agent-Key-Rechte umzubauen.
- Bereits erfüllte Punkte nur dokumentieren und zur gemeinsamen Abnahme vorlegen; keine nutzlose
  Neuimplementierung erzeugen.

Betroffene Dateien voraussichtlich: `server/public/js/notificationBanner.js`,
`server/public/js/views/home.js`, `server/src/test/e2e/flows.e2e.test.ts` sowie bei einem echten
Statusfehler die vorhandenen Live-State-Tests.

### 2. Gemeinsames Info-Tooltip/Popover

- Einen kleinen wiederverwendbaren Helper unter `server/public/js/` ergänzen, der Überschrift,
  Infoschalter und sicher escapten Hilfetext rendert und nach Re-Renders verdrahtet werden kann.
- Der Schalter verwendet `icon('info')`, einen deutschen zugänglichen Namen und eine stabile
  Beziehung zum Hilfetext. Er öffnet per Klick/Touch und Tastatur, schließt beim zweiten Auslösen,
  mit `Escape`, außerhalb des Popovers und beim Öffnen eines anderen Hinweises.
- Fokus bleibt nachvollziehbar; der Text enthält keine interaktiven Elemente. Hover darf auf Geräten
  mit Maus zusätzlich funktionieren, ist aber keine Voraussetzung.
- Darstellung in `style.css` ausschließlich mit vorhandenen Design-Tokens: erhöhte dunkle Fläche,
  Border, Radius, Shadow, lesbare maximale Breite und sichere Positionierung ohne horizontalen
  Seiten-Overflow auf dem Handy.
- Erste konkrete Nutzung:
  - „Captain Draft“: sichtbar „2–4 Captains wählen“, vollständiger Ablauf im Info-Popover.
  - Turnieroptionen „Sitznachbarn zusammen“, „Hin- und Rückspiel“ und „Ergebnisse inkl.
    Punktestand“ nur dann mit Hinweis versehen, wenn die gekürzte Beschriftung die Auswirkung nicht
    ausreichend erklärt.
- Texte, deren fachlicher Inhalt durch das Usermanagement wechselt (Einladung, Kiosk, Durchsage,
  Agent-Key), bekommen in diesem PR bewusst noch kein Tooltip.

Betroffene Dateien voraussichtlich: neuer Helper `server/public/js/infoTooltip.js`,
`server/public/css/style.css`, `server/public/js/views/matchmaking.js`,
`server/public/js/views/tournament.js` und E2E-Abdeckung.

### 3. Teams und Turniere gemeinsam vereinheitlichen

- Eine gemeinsame responsive Spieler-Auswahlklasse einführen: eine Spalte auf schmalen Handys,
  zwei bis vier Kachelbreiten je nach verfügbarem Platz auf Laptop/Desktop.
- In beiden Ansichten „Alle markieren“ und „Auswahl aufheben“ nahe der Teamanzahl anbieten. Die
  Buttons ändern nur die lokale Auswahl und erhalten den bereits eingegebenen Teamwert.
- Teamanzahl in „Teams“ mit `2` vorbelegen; den bisherigen Automatik-Hinweis entfernen.
- Beschriftungen und Symbole gemäß Feedback bereinigen, ohne Checkbox-Semantik zu ändern.
- Captain-Draft in „Captain Draft“ umbenennen, sichtbaren Kurztext einsetzen und den Langtext in den
  neuen Info-Popover verschieben.
- „Draft starten“ mittig unter „Teams auslosen“ ausrichten und erst bei gültiger Auswahl als primäre
  Aktion darstellen; `disabled` bleibt nicht nur farblich erkennbar.
- Team- und Vote-Historie standardmäßig einklappen; Lade-, Leer- und Ergebniszustände müssen auch im
  eingeklappten Aufbau stabil bleiben.
- Die Turnierübersicht zeigt maximal zwei Turnierkarten pro Zeile; eine einzelne Karte nutzt die
  volle Breite und weitere Karten brechen in die nächste Zeile um. Sie zeigt
  laufende Turniere beim geöffneten Anlageformular weiterhin davor und ordnet abgeschlossene
  Turniere danach in einer zweiten prominenten, standardmäßig eingeklappten Statusreihe ein. Der
  aufgeklappte Zustand bleibt bei Aktualisierungen innerhalb der Ansicht erhalten. Separate Statistik-Kacheln für
  Gesamtzahl, laufende Turniere und Teams entfallen. Die Detailansicht ergänzt Fortschritt, Teams
  und Teilnehmende; kleine Turnierbäume werden im verfügbaren Bereich zentriert.
- Die Spielerauswahl beim Anlegen erscheint mit zwei Kacheln pro Zeile und beliebig vielen Zeilen
  darunter; die Spielauswahl bleibt ein kompaktes Dropdown. Teamanzahl und Auswahlaktionen teilen
  sich dieselbe Steuerelementhöhe; Sitznachbarn, Punktestand und der gemeinsame Lobby-Hinweis
  verwenden die touch-tauglichen Info-Popovers statt dauerhaft sichtbarer Erklärtexte.
- Anzahl Teams erhält denselben Label-Abstand wie die Spielauswahl. „(optional)“ steht direkt hinter
  Lobby-Basisname und Lobby-Passwort. Zwischen aktueller
  Turnierreihe, geöffnetem Formular und abgeschlossener Reihe gilt derselbe vertikale Abstand.
- Aus dem optionalen Lobby-Basisnamen wird je Paarung ein stabiler Name mit Phase, Runde und
  Matchnummer erzeugt. Die Turnierdetailansicht zeigt unter „Aktive Lobbys“ alle aktuell spielbaren
  Paarungen mit eigenem Lobby-Namen, gemeinsamem Passwort, Gastgeber-Team und Kopieraktionen in
  höchstens zwei Karten pro Reihe. Liga und Gruppenphase begrenzen die Anzeige auf die aktuelle
  Runde; im K.O.-Baum erscheinen alle vollständig besetzten offenen Matches. Ergebnisfelder und
  Speichern-/Bearbeiten-Aktion im Turnierbaum belegen getrennte Flächen innerhalb der Matchbox und
  überlappen auch bei einem einzelnen Finale nicht. Die allgemeine Gastgeber-Regel liegt im
  Info-Popover direkt neben „Aktive Lobbys“.
- Teams, Teilnehmende und entschiedene Partien bilden unter „Turnierstatus“ einen eigenen Abschnitt,
  statt optisch zum darüberliegenden Lobby-Zugang zu gehören.
- Die Detailansicht kürzt die sichtbaren Formatangaben auf „Liga“ beziehungsweise „Gruppenphase +
  K.O.“ und verschiebt Modusdetails, Gruppenanzahl, Aufsteiger und Punktestand in das direkt
  anschließende Info-Popover. Liga-Runden verwenden dieselbe umrandete Akzentgruppe wie Gruppen- und
  K.O.-Phasen. Auch die Turnierübersicht verwendet nur die kompakten Formatnamen ohne Klammerzusatz.
- Teamkarten in der Detailansicht und in der Auslosung nutzen höchstens zwei Spalten. In der
  Auslosung lassen sich Gamer per Drag-and-drop, Touch-Auswahl oder Pfeiltasten zwischen Teams
  verschieben; das bisherige Team-Dropdown entfällt.
- Das Anlageformular trennt Auslosung und Modus als zwei umrandete Bereiche mit dezenter
  Akzentkante und kurzer Unterzeile statt nummerierter Kreise. Spiel, Teilnehmende und Teamvorschau
  gehören zur Auslosung; Format, Ergebnisoptionen, Lobby und Erstellung zum Modus.
- Die Erklärung zu „Gruppenphase + K.O.“ liegt als Info-Popover neben dem Turnierformat. Gruppe und
  Tabelle verwenden textliche Überschriften ohne zusätzliche dekorative Symbole. Jede Gruppe fasst
  ihre Tabelle und Runden in einem gemeinsamen umrandeten Bereich zusammen.
- Ein erneuter Klick auf den aktiven unteren Turnier-Tab führt immer zur Turnierübersicht zurück.
  Bereits erfasste Sieger und Punktestände lassen sich über eine eindeutige Bearbeiten-Aktion
  korrigieren. Abhängige K.O.-Ergebnisse werden dabei zurückgesetzt und Gruppen-Korrekturen bauen
  die K.O.-Phase neu auf, damit Rangliste und Turnierbaum konsistent bleiben.
- Die Teams-Seite übernimmt Spieler-Raster, Auslosungsbereich, Beschriftungen und Teamkarten aus
  dem Turnierformular. Ausgeloste Gamer wechseln auch dort per Drag-and-drop, Touch-Auswahl oder
  Pfeiltasten das Team; das alte Team-Dropdown entfällt.

Betroffene Dateien: `server/public/js/views/matchmaking.js`,
`server/public/js/views/tournament.js`, `server/public/js/views/votes.js`,
`server/public/css/style.css` und `server/src/test/e2e/flows.e2e.test.ts`.

### 4. Home, Rang und Vote aufräumen

- Home-Reihenfolge auf „Aktuell“, Live-Inhalte, Rangliste/Sitzplan und danach „Dein Status“ umstellen;
  „Aktuell“ nutzt die bereits responsive `card-grid` für mehrere Kacheln.
- Sitzplan erhält eine Überschrift analog zu Rangliste und Status; „Gesamte Rangliste“ ersetzt
  „Ganze Rangliste“.
- Die Meldungshistorie in die Glocke der Kopfzeile verschieben. Die neueste aktive, ungelesene
  Mitteilung bleibt zusätzlich als hervorgehobener Direktlink unter der Kopfzeile sichtbar; die
  frühere doppelte Home-Historie entfällt. Gelesen und persönlich ausgeblendet wird vorläufig anhand
  der lokal gewählten Spieleridentität.
- Die Glocken-Historie bietet persönliche Sammelaktionen für „Alle gelesen“ und
  „Alle löschen“. Die hervorgehobene Meldung nutzt wieder den Markenverlauf der Primärbuttons und
  verschwindet bei fachlicher Auflösung beziehungsweise exakt am hinterlegten Ablaufzeitpunkt.
- Einzelne ungelesene Mitteilungen nutzen eine kompakte Icon-Aktion direkt links neben Löschen,
  damit Aktionszeilen auf schmalen Displays nicht umbrechen. Mitteilungskategorien verwenden das
  gemeinsame Lucide-Set; Sammelbestellungen erhalten das Bestell- statt des alten Pizza-Symbols.
  Bereits gespeicherte Einträge mit Emoji-Präfix werden bei der Anzeige normalisiert. Der redundante
  „Neu“-Badge entfällt; ungelesene Einträge bleiben durch Rand und Hintergrund klar erkennbar.
- Wiederkehrende Fachsymbole werden zentral in `domainIcons.js` zugeordnet und von Navigation,
  Aktuell-Karten, Kiosk, Mitteilungen, Leerzuständen und Querverweisen wiederverwendet. Untere
  Navigation und „Mehr“ sind die verbindliche Referenz: Schwerter stehen für laufende Turniere,
  die Waage für Teams, der Aktivitäts-Puls für Skill, der Hamburger für Sammelbestellungen und der
  Pokal ausschließlich für Ranglisten, Ergebnisse beziehungsweise Siege.
- Die Ranglisten-Vorschau zeigt auf größeren Displays die ersten sechs Plätze in zwei Spalten und
  fällt auf schmalen Handys in eine fortlaufende Liste zurück.
- Spieler-Namen verwenden in Live-Status, Rangliste und Auswahlansichten denselben Namensstil;
  Formfelder erben seitenweit dieselbe Systemschrift. Der Home-Sitzplan richtet Avatar und Namen
  sauber aus, hebt Gamer-Namen lesbarer hervor und zeigt ihren Live-Status direkt dahinter als
  kompakten grünen, gelben oder roten Indikator.
- Rang-Titel, Kurztexte und Ergebnisformular bereinigen. Für die Spieler-Zuordnung eine stabile
  Grid-/Spaltenstruktur verwenden, damit Selects unabhängig von Namenslängen fluchten.
- Vote-Beschreibung auf „Punkte frei verteilen, höchste Summe gewinnt.“ kürzen, Aktionsbuttons
  ausrichten und Spiele ab `--bp-md` zweispaltig darstellen; auf dem Handy bleibt eine Spalte.
- Die Vote-Historie als eingeklapptes `<details>` mit dem ausdrücklich gewünschten lokalen
  Historien-Symbol ausführen; den alten Antipp-Erklärungstext entfernen.

Betroffene Dateien: `server/public/js/views/home.js`, `server/public/js/views/seating.js`,
`server/public/js/views/leaderboard.js`, `server/public/js/views/votes.js` und
`server/public/css/style.css`.

### 5. Unterseiten unter „Mehr“ konsistent bereinigen

- Einträge in `more.js` alphabetisch sortieren und die dort gewünschten Kurztexte aktualisieren
  („Essen“, „Minigame-Lobbies“, „Awards und Statistiken“, keine An-/Abreise-Beschreibung).
- Auf den Zielseiten die in der Feedbackliste genannten dekorativen Seiten-/Abschnittssymbole und
  Symbole in farbigen Textbuttons entfernen. Rein ikonische Aktionen wie Bearbeiten, Kopieren,
  Schließen oder Löschen bleiben erhalten und bekommen weiterhin zugängliche Namen.
- Info-Board-Inhalte durch eine klarere Typografie und Kartenhierarchie hervorheben, ohne die
  Aktionsbuttons zu vergrößern; das Seitentitel-Symbol entfällt.
- Essen-Texte vereinfachen und für die Datumsauswahl den vorhandenen `dateTimeField`-Helper wie bei
  An-/Abreise verwenden.
- An-/Abreise: Felder umbenennen, falsche Fahrgemeinschaftssymbole entfernen und Zeitangaben mit
  einer responsiven Feldreihe nebeneinanderstellen.
- Spieler und Admin nicht anfassen. Die wiederholten „Du bist …“-Karten zentral ausblenden, sobald
  lokal bereits eine Identität gewählt ist; Erstauswahl und Wechsel über „Mein Profil“ bleiben
  erhalten. Bei „Durchsage“ darüber hinaus nur den sicheren visuellen Punkt an der
  Historienüberschrift umsetzen; die übrigen Usermanagement-Punkte bleiben unverändert.

Betroffene Dateien vor allem: `server/public/js/views/more.js`, `infoBoard.js`, `gameCatalog.js`,
`foodOrders.js`, `arcade.js`, `arrivals.js`, `broadcast.js`, `hallOfFame.js` und
`server/public/css/style.css`.

### 6. Auswertungen, Profil und Einstellungen verschlanken

- Auswertungen: Kacheltext und Titel bereinigen, Symbole entfernen, Awards-Karten einheitlich mit
  dem Spieler in der unteren Kartenzeile ausrichten.
- „Längste Einzelsession pro Spiel“ in „Längste individuelle Session pro Spiel“ umbenennen und den
  vorhandenen Max-pro-Einzelsession-Pfad durch einen Unit-/Integrationstest gegen überlappende
  Sessions mehrerer Spieler absichern.
- Multitasking-Liste und Belegungsdiagramm nicht mehr laden/rendern; das Backend bleibt für eine
  spätere Achievement- oder überarbeitete Analyse nutzbar. Das Session-Protokoll wird als
  standardmäßig geschlossener Nachbereitungsbereich geführt.
- Die Zeit-/Event-Filterung selbst bleibt wegen des künftigen Event-Scopings unverändert.
- Profil: rein visuelle/textliche Punkte umsetzen (Erklärung entfernen, Felder nebeneinander,
  Sitzplan-Link bewerten, Abstände und Statistik-Titel). Der Agent-Bereich bleibt zurückgestellt.
- Einstellungen: nur sichere Oberflächenpunkte wie Titel-/Sitzplan-Symbole und „Download Backup“
  umsetzen. Event-, Einladungs- und Kiosk-Erklärungen bleiben zurückgestellt.

Betroffene Dateien: `server/public/js/views/analytics.js`, gegebenenfalls
`server/src/sessionStats.test.ts`, `server/public/js/views/profile.js`,
`server/public/js/views/myStats.js`, `server/public/js/views/games.js` und
`server/public/css/style.css`.

### 7. Produkt und Repository vollständig in „Respawn“ umbenennen

- Sichtbare Produkttexte, Wortmarke, Logo-Beschriftungen, PWA-Metadaten, Kiosk, Service Worker,
  Exporte, Backups und Tests auf „Respawn“ vereinheitlichen.
- Technische Bezeichner wie Paketnamen, Browser-Speicher, interne Events, Agent-Dateien,
  Installationspfade, Container-Referenzen und Deployment-Verzeichnisse ebenfalls umbenennen.
- Den Windows-Agent unter dem neuen Namen neu bauen; Dokumentation und Download-Tests folgen dem
  neuen Artefaktnamen.
- Den bestehenden Produktionspfad beim ersten Deployment verlustfrei auf `/opt/respawn` migrieren.
- Nach vollständig grünen lokalen Prüfungen das GitHub-Repository in `Respawn` umbenennen und erst
  danach die lokale `origin`-URL aktualisieren. Push und Merge bleiben separate Schritte.

### 8. Globale interaktive Suche ergänzen

- Ein Suchsymbol in der Kopfzeile öffnet eine responsive Command-Palette; `Strg/Cmd + K` und `/`
  bieten denselben schnellen Einstieg per Tastatur.
- Der lokale Index umfasst alle Hauptbereiche, Tools und persönliche Ziele sowie verständliche
  Synonyme wie „Captain Draft“, „Voting“, „Anreise“ oder „WLAN“. Zusätzlich werden Spieler, Spiele,
  Events, Bestellungen samt Positionen, Info-Board-Einträge, Durchsagen, Fahrgemeinschaften,
  Turniere und persönliche Mitteilungen aus State und bestehenden APIs indexiert.
- Vor der Eingabe bleibt die Ergebnisliste leer; Startvorschläge und eine separate
  Tastaturerklärung entfallen.
- Das Suchfeld verwendet die gemeinsame Eingabegrundlage, erhält innerhalb des großen Dialogs aber
  den Kartenradius, damit es nicht eckiger als die umgebende Oberfläche wirkt.
- Treffer werden während der Eingabe gefiltert und lassen sich per Touch, Maus, Pfeiltasten und
  Enter öffnen. Escape, Klick auf den Hintergrund und der Schließen-Button schließen die Palette
  und geben den Fokus an den Auslöser zurück.
- Inhaltstreffer navigieren in den passenden Bereich und markieren dort das konkrete Ziel, sofern
  die Ansicht eine stabile Zielkarte oder -zeile besitzt; Turniertreffer öffnen direkt das Turnier.

## Test- und Abnahmeplan

### Automatisiert

Aus `server/`:

```bash
npm run lint
npm run format:check
npm run check:tokens
npm run build
npm test
npm run test:e2e
```

E2E-Abdeckung ergänzt mindestens:

- Info-Popover per Klick, Tastatur und `Escape`, inklusive nur eines offenen Popovers.
- Mehrspaltige Spieler-/Vote-Auswahl auf Laptop und einspaltiger, overflow-freier Aufbau auf Handy.
- „Alle markieren“/„Auswahl aufheben“, Teamwert `2` und gültiger/ungültiger Draft-Startzustand.
- Standardmäßig geschlossene Team-/Vote-Historien und weiterhin erreichbare Historieninhalte.
- Meldungsliste, Gelesenstatus, persönliches Ausblenden, Deep-Link und `Escape` im Browser abdecken.
- Datumsauswahl in Essen mit demselben Helper-Verhalten wie An-/Abreise.

### Manuell

- Phone und Laptop, Browser-Zoom sowie lange Spieler-, Spiel- und Info-Board-Texte prüfen.
- Fokusreihenfolge, sichtbaren Fokus, Touch-Zielgröße, Screenreader-Namen und `Escape`-Verhalten des
  Info-Popovers kontrollieren.
- Lade-, Leer-, Fehler-, Disabled- und lange Historienzustände je betroffener Ansicht prüfen.
- Symbol-Audit: keine dekorativen Icons in bereinigten Titeln/farbigen Buttons, aber notwendige
  Status- und Icon-only-Aktionen bleiben verständlich.
- Feedback-Checkboxen erst nach gemeinsamer visueller Abnahme auf `[x]` setzen.

## Bewusst nicht Bestandteil dieses PRs

- Alle weiterhin mit `Kommentar (Usermanagement)` markierten Punkte.
- Neue Login-, Session-, Rollen-, Rechte-, Invite-, Kiosk-Token- oder Event-Scoping-Logik.
- Löschen oder Deaktivieren von Spielern sowie Änderungen an Agent-Key-Sichtbarkeit/-Rotation.
- Authentifizierte Session-Zuordnung des vorläufig spielerbezogenen Meldungsstatus.
- Branch pushen, GitHub-PR eröffnen oder mergen.
- Backend-Analytics-Endpunkte nur deshalb löschen, weil ihre aktuelle UI ausgeblendet wird.

## Reviewbare Commit-Reihenfolge

1. `feat: add accessible contextual info popovers`
2. `feat: refine tournament team and voting layouts`
3. `refactor: simplify secondary view copy and icons`
4. `refactor: streamline analytics profile and settings views`
5. `test: cover general UI polish flows`
6. `feat: add personal header notification center`
7. `chore: rename product and technical references to Respawn`

Nach jedem Commit bleibt die App lauffähig; Dokumentation und Tests werden spätestens im selben
Arbeitspaket aktualisiert. Sachfremde oder bereits vorhandene Nutzeränderungen werden nicht gestaged.
