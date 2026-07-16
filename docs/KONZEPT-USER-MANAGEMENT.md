# Konzept: User-, Gruppen- und Event-Management

Stand: Juli 2026 · Status: **verbindliches Zielkonzept** (Rev. 4 – Mehrgruppenmodell)

Dieses Dokument beschreibt das Zielbild für persönliche Konten, mehrere voneinander getrennte
Freundesgruppen, zeitlich begrenzte Events, Tracking und Administration. Rev. 4 ersetzt die frühere
Annahme „eine Freundesgruppe pro Instanz“. Eine Person kann nun mehreren Gruppen angehören; jede
Gruppe ist eine eigene Autorisierungs- und Datengrenze.

Die Authentifizierungsgrundlage aus PR #197 (Phasen 1–4) bleibt gültig. Der frühere Plan für
„Phase 5 – Event-Sichtbarkeit“ wird nicht umgesetzt: Event-Scoping allein wäre bei mehreren Gruppen
keine ausreichende Mandantentrennung.

---

## 1. Zusammenfassung und Urteil

Das vorgeschlagene Modell ist sinnvoll, wenn die **Gruppe** – nicht das Event – die dauerhafte
Arbeitsfläche und Sicherheitsgrenze wird:

- Eine Person hat genau ein globales Konto und kann Mitglied mehrerer Gruppen sein.
- Gruppen bestehen dauerhaft und funktionieren auch ohne laufendes Event.
- Der Beitritt zu einer Gruppe erfolgt ausschließlich über eine Einladung und aktive Annahme.
- Ein Event gehört genau einer Gruppe und hat einen begrenzten Zeitraum.
- Zunächst können nur aktive Gruppenmitglieder an einem Event teilnehmen.
- Gruppenbezogene Daten sind ausschließlich für Mitglieder dieser Gruppe sichtbar.
- Gruppen-Tracking kann außerhalb von Events pro Person und Gruppe deaktiviert werden.
- Event-Auswertungen verwenden den zeitlichen Ausschnitt der Gruppendaten und nur die Daten der
  Event-Teilnehmenden.
- Gruppen-Admins verwalten Mitglieder, Events und gruppeneigene Daten, aber nicht das globale Konto
  oder Mitgliedschaften derselben Person in anderen Gruppen.

Die wichtigsten Ergänzungen gegenüber der Ausgangsidee sind:

1. **Expliziter Gruppenkontext:** Jede Gruppenaktion wird serverseitig an eine geprüfte
   Gruppenmitgliedschaft gebunden. Eine frei übergebene `groupId` ist niemals allein ausreichend.
2. **Keine globale Datenkopie als Hintertür:** Tracking- und Fachdaten werden gruppenbezogen
   gespeichert. Eine Gruppe darf keine Daten einer anderen Gruppe abfragen oder nachträglich
   „einsammeln“.
3. **Einwilligung statt Admin-Schalter:** Nur die Person selbst darf Tracking aktivieren. Ein
   Gruppen-Admin kann Tracking-Daten löschen, aber Tracking nicht für andere einschalten.
4. **Eigentümerrolle:** Jede Gruppe hat mindestens einen Owner. Dadurch kann der letzte Admin nicht
   versehentlich entfernt werden und die Gruppe bleibt verwaltbar.
5. **Einladungen werden angenommen:** Anders als die bisherige Event-Teilnehmerliste erzeugt eine
   Gruppeneinladung nicht sofort Zugriff. Erst Annahme des Einmal-Links aktiviert die Mitgliedschaft.
6. **Bestandsmigration in eine Startgruppe:** Alle vorhandenen Daten werden einer automatisch
   erzeugten Gruppe zugeordnet. Der bisherige Sentinel „Außerhalb von Events“ wird zum normalen
   Gruppenraum ohne `event_id`.

---

## 2. Ziele und Nicht-Ziele

### 2.1 Ziele

- Ein Konto pro Mensch, unabhängig von Gruppen und Events.
- Saubere Trennung zwischen Gruppen auf derselben Instanz.
- Dauerhafte Nutzung einer Gruppe für Spiele, Live-Status, Abstimmungen, Matches und Organisation.
- Events als zeitlich begrenzte, optionale Unterräume einer Gruppe.
- Einfache Einladung per Einmal-Link ohne E-Mail-Infrastruktur.
- Transparente, pro Gruppe steuerbare Tracking-Einwilligung.
- Administration dort, wo die Verantwortung liegt: innerhalb der jeweiligen Gruppe.
- Weiterhin einfache Bedienung für ungefähr 15 Personen pro Gruppe.

### 2.2 Nicht-Ziele der ersten Ausbaustufe

- Keine Organisationen mit Untergruppen oder verschachtelten Gruppen.
- Keine öffentlichen Gruppen und keine durchsuchbare Gruppenliste.
- Keine Abrechnung, Quoten oder Enterprise-Mandantenverwaltung.
- Keine gruppenübergreifenden Ranglisten oder Auswertungen.
- Keine Gäste ohne Gruppenmitgliedschaft in der ersten Ausbaustufe.
- Keine automatische Zusammenführung ähnlicher Spiele oder Profile zwischen Gruppen.
- Keine feingranularen ACLs pro Datensatz; Rollen und Zugehörigkeit reichen aus.

### 2.3 Bereits umgesetztes Auth-Fundament

Das Mehrgruppenmodell baut auf den Phasen 1–4 aus PR #197 auf und ändert deren
Authentifizierungsentscheidungen nicht:

- Name + Passwort mit persönlichem, serverseitig gehashtem Session-Token im HTTP-only-Cookie.
- Passwortlänge 15–200 Zeichen, keine Komplexitätsregeln und keine erzwungene Rotation; UI mit
  Sichtbar-Toggle, Passphrase-Hinweis und Passwortmanager-kompatiblem `autocomplete`.
- scrypt-Hashing. Vor einer Kostenerhöhung wird von `scryptSync` auf asynchrones `crypto.scrypt`
  gewechselt und auf der Zielhardware gebenchmarkt, damit Login-Spitzen den Event Loop nicht
  blockieren.
- 90 Tage gleitende Session-Laufzeit, hart begrenzt auf 180 Tage.
- Cookie `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` und im HTTPS-Modus mit `__Host-`-Präfix;
  Session-Tokens erscheinen nie in URLs oder Logs.
- Registrierung, Claim und Passwort-Reset nur über atomar einmal nutzbare, ablaufende und
  widerrufbare Codes. Passwortänderung und Reset invalidieren alte Sessions und Sockets.
- Konto- und globales Auth-Rate-Limit, konstante Passwortprüfung auch für unbekannte Konten und
  `Retry-After` bei Sperren.
- Fünf Minuten gültige, sessiongebundene Step-up-Reauthentifizierung für kritische Admin-Aktionen.
- `AUTH_MODE=required` bindet REST- und Socket-Akteure an die Session; Shared Token und Admin-PIN
  sind dort außer Betrieb.

Der Abgleich gegen kompromittierte Passwörter ist durch `v5.0.0-6.2.12` verbindlich. Offen bleibt
nur die Datenquelle: HIBP per k-Anonymity mit lokalem Ausfallkonzept oder eine lokal aktualisierte
Breach-Liste. Ein bloßes dauerhaftes Fail-open ohne Ersatzprüfung erfüllt die Baseline nicht.

---

## 3. Domänenmodell

### 3.1 Globale Konten

Der bestehende `players`-Datensatz bleibt das globale Konto. Global sind nur Daten, die wirklich zur
Person oder Anmeldung gehören:

- ID, Login-Name, Passwort-Hash und Sessions
- Avatar und optionale globale Profilangaben
- Agent-API-Key und Kontostatus
- Instanzrolle für technische Wiederherstellung

Gruppenbezogene Rollen, Tracking-Einstellungen, Skills, Präferenzen und Aktivitätsdaten gehören
nicht in `players`.

Ein Login gewährt noch keinen Zugriff auf Gruppendaten. Zugriff entsteht erst durch eine aktive
Mitgliedschaft.

### 3.2 Gruppen

Neue Tabelle `groups`:

| Feld | Bedeutung |
|---|---|
| `id` | nicht erratbare `nanoid` |
| `name` | Anzeigename, nicht global eindeutig erforderlich |
| `description` | optionale Beschreibung |
| `created_by` | globales Konto des Erstellers |
| `created_at` | Erstellungszeitpunkt |
| `archived_at` | archiviert statt sofort gelöscht |

Gruppen sind privat. Es gibt keinen Endpoint, der einem Nichtmitglied Namen oder Existenz fremder
Gruppen verrät.

Jedes beanspruchte echte Konto darf eine Gruppe anlegen und wird ihr erster Owner. Dafür ist keine
Instanz-Adminrolle erforderlich. Ab der Anlage wird jede Aktion in dieser Gruppendomäne ausschließlich
durch die aktive Gruppenmitgliedschaft und die Gruppenrolle autorisiert.

### 3.3 Gruppenmitgliedschaften

Neue Tabelle `group_memberships`:

| Feld | Bedeutung |
|---|---|
| `group_id`, `player_id` | zusammengesetzter Schlüssel |
| `role` | `owner`, `admin` oder `member` |
| `status` | `invited`, `active`, `removed` oder `left` |
| `joined_at` | Zeitpunkt der Annahme |
| `ended_at` | Austritt oder Entfernung |
| `outside_tracking_enabled` | aktuelle Tracking-Voreinstellung außerhalb von Events; nur durch die Person änderbar |
| `invited_by` | einladender Gruppen-Admin |

Historische Mitgliedschaften bleiben erhalten. Das ist nötig, damit alte Ergebnisse und Audit-Einträge
weiterhin einer Person zugeordnet werden können. `active` entscheidet über aktuellen Zugriff.

Zusätzlich historisiert `tracking_consents` jede Aktivierung und jeden Widerruf mit `group_id`,
`player_id`, optionaler `event_id`, `valid_from` und `valid_until`. Der aktuelle Boolean an der
Mitgliedschaft ist nur die schnelle Voreinstellung für den Gruppenraum; Auswertungen vergangener
Zeiträume dürfen nicht vom heutigen Schalterzustand abhängen.

Ein optionaler gruppenspezifischer Anzeigename kann später ergänzt werden. In der ersten Version gilt
der globale Spielername in allen Gruppen, um Login und Personenwahl einfach zu halten.

### 3.4 Events

`events` erhält ein verpflichtendes `group_id`. Ein Event gehört unveränderlich genau einer Gruppe.

| Feld | Bedeutung |
|---|---|
| `group_id` | besitzende Gruppe |
| `starts_at`, `ends_at` | verpflichtender, begrenzter Zeitraum |
| `status` | `draft`, `published`, `cancelled`, `ended` |
| übrige Felder | Name, Ort, Beschreibung |

`ends_at` muss nach `starts_at` liegen. Der Gruppenraum existiert unabhängig davon dauerhaft; ein
Sentinel-Event ist im Zielmodell nicht mehr nötig.

### 3.5 Event-Teilnahme

`event_participants` referenziert Event und Gruppenmitgliedschaft. In der ersten Version dürfen nur
aktive Mitglieder der besitzenden Gruppe hinzugefügt werden.

Die Teilnahme kann die Zustände `invited`, `accepted`, `declined`, `removed` haben. Damit ist klar,
wer nur eingeladen wurde und wer tatsächlich teilnehmen sowie Event-Nachrichten erhalten möchte.
Rückwirkende Event-Sichtbarkeit beginnt mit der Annahme und umfasst das gesamte Event.
Zusätzlich speichert die Teilnahme die persönliche Event-Tracking-Zustimmung; sie darf ausschließlich
von der betroffenen Person gesetzt oder widerrufen werden.

**Späteres Gastmodell:** Ein Gast ist weiterhin ein echtes globales Konto, erhält aber eine direkte,
zeitlich begrenzte `event_guest_membership`. Das gewährt ausschließlich Zugriff auf dieses Event,
nicht auf den Gruppenraum, Mitgliederverwaltung oder andere Events. Anonyme Gastlinks ohne Konto
bleiben ausgeschlossen.

### 3.6 Invariante für Spielerreferenzen

Jede Spielerreferenz in einer Gruppendomäne muss genau einen der folgenden Nachweise tragen:

1. Für neue oder noch veränderliche Daten verweist sie auf eine zum Schreibzeitpunkt **aktive
   Mitgliedschaft derselben Gruppe**. Eine bloße globale `player_id` ist nicht ausreichend.
2. Für abgeschlossene historische Daten verweist sie auf die damalige Mitgliedschaft und enthält
   einen **unveränderlichen Snapshot** der für die Darstellung nötigen Spielerangaben, mindestens
   Anzeigename und stabile Spieler-ID. Der Snapshot wird beim Abschluss oder beim Ende der
   Mitgliedschaft eingefroren und darf keine aktuellen Rechte begründen.

Das gilt ausnahmslos für Teilnehmende, Teams, Matches, Turniere, Votes, Sitzbeziehungen,
Bestellungen, Anreisen, Tracking-Sessions, Leaderboards sowie Arcade-Lobbys und -Ergebnisse. Nach
Austritt oder Entfernung dürfen keine neuen Referenzen auf die Person entstehen; bestehende
historische Einträge bleiben über ihren Snapshot vollständig und nachvollziehbar. Resolver,
Migrationen und Foreign-Key-/Trigger-Invarianten verhindern gruppenfremde oder snapshotlose
Spielerreferenzen.

---

## 4. Rollen und Verantwortlichkeiten

### 4.1 Instanzrolle

Die bestehende globale Rolle `players.is_admin` wird langfristig zur **Instanz-Adminrolle**. Sie ist
für Bootstrap, Account-Recovery und technischen Betrieb gedacht. Sie macht eine Person nicht
automatisch zum Gruppen-Admin und gewährt im normalen Produktpfad keinen stillen Zugriff auf alle
Gruppeninhalte.

Für Gruppendomänen hat die Instanzrolle keinerlei implizite Berechtigung. Mitglieder, Rollen,
Events, Fachdaten, Audit, Exporte und Löschungen werden ausschließlich durch `owner`, `admin` oder
`member` der betroffenen Gruppe gesteuert. Auch die Anlage einer Gruppe ist keine
Instanz-Adminaktion: Jedes beanspruchte echte Konto darf sie auslösen und erhält dadurch die erste
Owner-Mitgliedschaft.

Ein später notwendiger Break-glass-Zugriff auf eine Gruppe muss ausdrücklich gestartet, zeitlich
begrenzt, sichtbar angezeigt und vollständig auditiert werden. Für die erste Ausbaustufe bleibt
Instanz-Recovery auf das globale Konto begrenzt und verleiht keine Gruppenrechte; ein allgemeines
„alle Gruppen ansehen“ wird nicht angeboten.

### 4.2 Gruppenrollen

| Aktion | Member | Admin | Owner |
|---|---:|---:|---:|
| Gruppenraum und eigene Events sehen | ✅ | ✅ | ✅ |
| Eigene Skills, Präferenzen und Tracking-Einwilligung ändern | ✅ | ✅ | ✅ |
| An Gruppenaktionen teilnehmen | ✅ | ✅ | ✅ |
| Mitglieder einladen und entfernen | ❌ | ✅ | ✅ |
| Events anlegen und verwalten | ❌ | ✅ | ✅ |
| Gruppendaten moderieren/löschen | ❌ | ✅ | ✅ |
| Rollen `member` ↔ `admin` ändern | ❌ | ✅ | ✅ |
| Owner ernennen oder entfernen | ❌ | ❌ | ✅ |
| Gruppe archivieren/löschen | ❌ | ❌ | ✅ |

Regeln:

- Der Ersteller einer Gruppe wird ihr erster Owner.
- Gruppendomänen werden ausschließlich über diese Gruppenrollen verwaltet; die Instanzrolle ist
  weder Ersatzmitgliedschaft noch Rollen-Bypass.
- Jede aktive Gruppe hat mindestens einen Owner.
- Der letzte Owner kann weder austreten noch entfernt oder degradiert werden.
- Ein Admin darf sich nicht selbst zum Owner machen.
- Rollenänderungen wirken pro Request und auf offenen Socket-Verbindungen sofort.
- Kritische Aktionen verwenden die bereits vorhandene Step-up-Reauthentifizierung.
- Test-User dürfen nicht Owner oder Gruppen-Admin werden.

Test-User werden im Mehrgruppenmodell von genau einer Gruppe besessen (`test_owner_group_id`). Nur
Admins dieser Gruppe dürfen sie anlegen, sehen und impersonieren. Während der Impersonation gelten
ausschließlich Mitgliedschaften und Rechte des Test-Users; die Adminrechte des Session-Inhabers
werden nicht geerbt. Der sichtbare Impersonations-Banner und der jederzeit erreichbare Rückweg zur
eigenen Identität bleiben verpflichtend.

### 4.3 Event-Rollen

Für die erste Version verwalten Gruppen-Admins alle Events. Eine zusätzliche Rolle `organizer` kann
später in `event_participants.role` ergänzt werden, falls normale Mitglieder nur ein bestimmtes Event
organisieren dürfen. Sie ist kein Bestandteil der ersten Migration.

---

## 5. Gruppenkontext und Autorisierung

### 5.1 Kontextwahl

Die App erhält einen sichtbaren Gruppenumschalter. Die gewählte Gruppe wird pro Tab in der URL oder
im Tab-Zustand gehalten, damit zwei Tabs gleichzeitig unterschiedliche Gruppen anzeigen können.
Ein sessionweit gespeichertes `active_group_id` wäre dafür ungeeignet.

Bei jeder Anfrage wird die angeforderte Gruppe serverseitig gegen die authentifizierte Person und
eine aktive Mitgliedschaft geprüft. Der Client darf eine `groupId` auswählen, aber niemals deren
Berechtigung behaupten.

Zentrale Serverhelfer:

- `requireGroupMembership` – authentifiziert, löst Gruppe auf und liefert bei fremden Gruppen `404`.
- `requireGroupRole('admin')` – verlangt Gruppen-Admin oder Owner.
- `requireGroupOwner` – verlangt Owner.
- `resolveGroupResource(resourceType, id)` – lädt Ressource zusammen mit `group_id`, nie erst global
  per ID und danach ungeprüft.
- `requireEventAccess` – leitet die Gruppe aus dem Event ab und prüft akzeptierte Teilnahme bzw.
  Gruppen-Adminrechte.

Alle Objektzugriffe verwenden `group_id + resource_id` oder einen zentralen Resolver. Nicht erratbare
IDs bleiben Defense-in-depth, ersetzen aber keine Autorisierung.

### 5.2 Datenklassen

| Datenart | Sichtbarkeit |
|---|---|
| Globales eigenes Konto, Sessions, Agent-Key | nur die Person; Instanz-Recovery eng begrenzt |
| Öffentliche Profilkarte eines Mitglieds | aktive Mitglieder derselben Gruppe |
| Gruppenmitglieder, Spielekatalog, Skills, Präferenzen | aktive Mitglieder derselben Gruppe |
| Gruppenraum-Daten ohne Event | aktive Mitglieder derselben Gruppe |
| Event-Daten | akzeptierte Teilnehmende sowie Gruppen-Admins/Owner |
| Gruppen-Audit | Gruppen-Admins/Owner |
| Instanz-Audit | Instanz-Admins |

Es gibt keine gruppenübergreifende Hall of Fame, keinen globalen Mitgliederkatalog und keine globale
Spieler- oder Spiele-Suche. Eine Person, die in zwei Gruppen ist, sieht die Daten beider Gruppen nur
nach bewusstem Kontextwechsel.

### 5.3 Serverantwort bei Grenzverletzungen

- Nicht angemeldet: `401`
- Angemeldet, aber fremde Gruppe oder fremde Ressource: `404`, damit ihre Existenz nicht verraten wird
- Mitglied, aber unzureichende Gruppenrolle: `403`
- Nicht mehr aktive Mitgliedschaft: bestehende Sessions bleiben gültig, verlieren aber sofort den
  Zugriff auf diese Gruppe

Cross-Group-Zugriffsversuche werden mit Akteur, eigener Gruppe, angefragter Gruppe, Ressourcentyp und
Zeitpunkt auditiert – ohne sensible Inhalte oder Tokens zu protokollieren.

---

## 6. Einladungen und Lebenszyklus

### 6.1 Konto-Einladung und Gruppeneinladung sind getrennt

Die bestehende Auth-Einladung erstellt oder übernimmt ein globales Konto. Eine neue
`group_invites`-Tabelle autorisiert ausschließlich den Beitritt zu einer Gruppe.

Ein Gruppen-Admin kann:

- ein bestehendes Konto gezielt einladen, sofern es ihm innerhalb eines bereits gemeinsamen
  Gruppenkontexts bekannt ist, oder
- einen einmaligen Gruppenlink erzeugen, den eine eingeloggte Person annimmt.

Der Code ist zufällig, läuft ab, ist widerrufbar, wird atomar einmal konsumiert und erscheint nicht
in Logs. Nach Öffnen des Links sieht die Person Gruppenname, Einladenden und die Tracking-Voreinstellung
und bestätigt den Beitritt ausdrücklich.

Ist auf dem Gerät noch kein Konto angemeldet, führt derselbe Gruppenlink zuerst durch Login oder
Account-Onboarding und danach zurück zur Bestätigung der Gruppe. Der Gruppencode wird dabei noch
nicht konsumiert. Kontoerstellung und Gruppenbeitritt bleiben intern zwei atomare Schritte mit
getrennten Code-Arten, wirken für neue Personen aber wie ein zusammenhängender Ablauf.

Gruppenlinks verleihen immer zunächst `member`. Admin- oder Ownerrechte werden erst nach dem Beitritt
in einer separaten, reauthentifizierten Aktion vergeben.

### 6.2 Austritt und Entfernung

- Ein Member kann eine Gruppe selbst verlassen.
- Admins können Members und andere Admins entfernen; Owner nur durch einen Owner.
- Der letzte Owner ist geschützt.
- Austritt/Entfernung beendet sofort Gruppen-Realtime, Gruppen-Push und neue Tracking-Erfassung.
- Historische Datensätze bleiben für die Gruppe erhalten; die Person verliert den Zugriff darauf.
- Eine erneute Einladung erstellt keine zweite Mitgliedschaft, sondern reaktiviert nach Annahme die
  bestehende Historienzeile.

### 6.3 Gruppenarchivierung und Löschung

Archivieren ist der Standard: keine neuen Aktionen, Einladungen oder Tracking-Daten; Historie bleibt
für Mitglieder lesbar. Hartes Löschen ist eine Owner-Aktion mit Step-up, Vorschau der betroffenen
Datenmengen und klarer Kaskadenwarnung. Eine spätere Aufbewahrungsfrist kann ergänzt werden; bis dahin
erfolgt kein automatisches Löschen.

---

## 7. Gruppenraum, Events und Fachdaten

### 7.1 Gruppenraum statt Sentinel

Fachdaten tragen künftig immer `group_id` und optional `event_id`:

- `event_id IS NULL`: dauerhafter Gruppenraum außerhalb eines Events
- `event_id = <id>`: explizit diesem Event zugeordnete Aktion

Die Datenbank stellt sicher, dass ein referenziertes Event zur gleichen Gruppe gehört. Wo SQLite
keinen Cross-Table-`CHECK` erlaubt, werden Events zusätzlich über `(group_id, id)` eindeutig und
Kinder über einen zusammengesetzten Foreign Key `(group_id, event_id)` gebunden. Wo das bestehende
Schema diesen Umbau noch nicht zulässt, erzwingen Transaktion und getesteter Resolver dieselbe
Invariante bis zur Folgemigration.

### 7.2 Welche Daten sind gruppenbezogen?

Mindestens folgende Bereiche erhalten `group_id`:

- Gruppen-Spielekatalog, Skills und Spielpräferenzen
- Tracking-Sessions und Live-Status
- Matches, Matchmaking-Auslosungen und Leaderboard
- Abstimmungen, Vote-Runden und Drafts
- Turniere
- Sitzplan, Sitznachbarn und Pings
- Bestellungen, Anreisen und Fahrgemeinschaften
- Durchsagen, Push-Historie und Info-Board
- Arcade-Lobbys, Zuschauerlisten und Ergebnisse

Globale Tabellen bleiben auf Authentifizierung, Sessions, Konten, technische Agent-Zuordnung und
**unveränderliche globale Arcade-Titeldefinitionen** beschränkt. Diese Definitionen enthalten nur
die technische Identität eines eingebauten Arcade-Titels. Konfiguration, Freischaltung, Lobby,
Zuschauer, Match, Ergebnis, Rangliste und jeder Spielerbezug sind weiterhin gruppenbezogen. Eine
änderbare oder gruppenspezifisch erweiterte Titeldefinition verliert die Ausnahme und erhält
`group_id`.

### 7.3 Event-Zuordnung von Aktionen

Die UI zeigt immer den aktuellen Kontext: Gruppenname und entweder „Gruppenraum“ oder Eventname.
Eine fachliche Aktion wird nicht mehr anhand eines globalen Tracking-Schalters einem Event
zugeordnet. Sie verwendet den expliziten, autorisierten UI-Kontext.

Dadurch funktionieren parallel:

- mehrere Gruppen,
- mehrere Tabs einer Person,
- überlappende Events verschiedener Gruppen,
- ein Gruppenraum während eines laufenden Events.

Innerhalb derselben Gruppe sind überlappende veröffentlichte Events in Version 1 nicht erlaubt. Das
verhindert doppelte Zuordnung und unklare Push-/Live-Zustände. Entwürfe dürfen sich überschneiden.

„Zeitlich begrenzt“ bedeutet nicht, dass ein Event erst bei `starts_at` sichtbar wird: akzeptierte
Teilnehmende dürfen veröffentlichte Events vorher zur Planung (Anreise, Sitzplan, Bestellungen) und
danach als Historie sehen. Der Zeitraum begrenzt Tracking und Live-Auswertung. Nach `ended` werden
normale operative Schreibpfade geschlossen; klar benannte Nachbereitung und Admin-Korrekturen
bleiben möglich.

### 7.4 Event-Auswertungen

Tracking wird gruppenbezogen gespeichert. Jede Play-Session trägt zusätzlich einen
`visibility_scope` (`group` oder `event`) und bei Event-only-Einwilligung die zugehörige `event_id`.
Eine Event-Auswertung schneidet diese Daten anhand folgender Bedingungen zu:

1. `group_id` entspricht der Event-Gruppe,
2. Person ist akzeptierte Event-Teilnehmerin,
3. Aktivität überschneidet sich mit `[starts_at, ends_at)`,
4. für den Zeitraum besteht eine Event-Tracking-Zustimmung,
5. `group`-Sessions oder genau für dieses Event freigegebene `event`-Sessions dürfen einfließen,
6. nur der zeitliche Überlappungsanteil zählt.

Besteht sowohl Gruppenraum- als auch Event-Einwilligung, wird die Aktivität nur einmal als
`group`-Session gespeichert und für die Event-Auswertung gefiltert wiederverwendet. Besteht nur die
Event-Einwilligung, entsteht eine `event`-Session, die außerhalb dieses Events weder in Live-Board
noch Gruppenstatistik erscheint. Besteht nur die Gruppenraum-Einwilligung, bleibt die Aktivität in
der Gruppenhistorie, wird aber nicht für das Event verwendet. Nicht-Tracking-Daten wie Votes oder
Bestellungen tragen weiterhin eine explizite `event_id`, weil sie nicht allein aus Zeitstempeln
abgeleitet werden können.

---

## 8. Tracking und Privatsphäre

### 8.1 Grundregel

Der Agent authentifiziert weiterhin das globale Konto. Ein Report wird beim Eingang auf die
berechtigten Gruppen aufgefächert:

- aktive Gruppenmitgliedschaft,
- Konto und Mitgliedschaft nicht deaktiviert,
- außerhalb eines Events: `outside_tracking_enabled = 1`,
- innerhalb eines akzeptierten Events: Event-Tracking-Zustimmung aktiv,
- bei beiden Einwilligungen wird nicht doppelt gespeichert, sondern der weitergehende
  `group`-Scope verwendet.

Es gibt keine dauerhaft gespeicherte globale Rohaktivität, die Gruppen später rückwirkend abfragen
könnten. Ist für keine Gruppe Tracking erlaubt, wird der Report nur als technischer Heartbeat
verarbeitet und nicht als Spielaktivität gespeichert.

Ist eine Person Mitglied mehrerer Gruppen und hat Tracking dort aktiviert, wird dieselbe reale
Aktivität gleichzeitig in jeder dieser Gruppen berücksichtigt. Das ist beabsichtigt; Gruppen können
einander daraus weder erkennen noch Daten vergleichen.

Der Server liefert dem Agenten die Vereinigungsmenge der Prozesszuordnungen aus allen aktiven,
trackingberechtigten Gruppenmitgliedschaften. Ein Prozess kann in zwei Gruppen bewusst
unterschiedlichen Spieleinträgen zugeordnet sein; der Report wird deshalb pro Gruppe mit deren
eigener Zuordnung ausgewertet. Gruppen- oder Spiele-IDs anderer Gruppen werden dem Agenten nicht als
frei nutzbare Schreibberechtigung überlassen.

### 8.2 Einwilligungen

- Außerhalb von Events gilt eine **gruppenbezogene** Einstellung, standardmäßig aus.
- Beim Annehmen einer Event-Einladung wird transparent erklärt, dass Tracking während des
  Eventzeitraums für Event-Auswertungen verwendet wird; Zustimmung ist separat widerrufbar.
- Zusätzlich bleibt ein globaler „Tracking pausieren“-Notschalter bestehen und gewinnt immer.
- Gruppen-Admins können Einwilligungen sehen, aber niemals für andere aktivieren.
- Widerruf stoppt neue Erfassung sofort, beendet offene Sessions zum Widerrufszeitpunkt und entfernt
  Live-Status. Bereits rechtmäßig erfasste Historie bleibt zunächst erhalten; Löschen ist eine
  separate Aktion.
- Die Person kann ihre eigenen Tracking-Daten pro Gruppe löschen lassen bzw. selbst löschen, soweit
  dadurch keine fremden Match-Ergebnisse zerstört werden. Reine Play-Sessions sind löschbar.
- Einwilligungsintervalle werden für die korrekte historische Auswertung aufbewahrt, aber nicht als
  Erlaubnis für neue Daten wiederverwendet. Der aktuelle Zeitpunkt muss immer in einem offenen
  Intervall liegen.

### 8.3 Zeitgrenzen

Event-Tracking beginnt frühestens bei `starts_at` und endet spätestens bei `ends_at`, unabhängig
davon, ob ein Admin die App geöffnet hat. Ein optionaler manueller Status „Event läuft“ darf Live-UI
steuern, aber niemals den zulässigen Auswertungszeitraum erweitern.

Offene Sessions werden bei Ende des Zeitraums, Widerruf, Austritt, Entfernung oder Kontodeaktivierung
sauber geschlossen. Die Verarbeitung muss idempotent sein, damit verspätete Agent-Reports keine
beendete Session wieder öffnen.

---

## 9. Realtime, Push, Kiosk und Arcade

### 9.1 Socket.IO

Ein Socket tritt nach Authentifizierung nur einem bewusst gewählten `group:<id>`-Room und optional
`event:<id>` bei. Der Server validiert Mitgliedschaft bzw. Event-Teilnahme bei jedem Subscribe.
Beim Gruppenwechsel verlässt der Socket die alten Räume.

Rollenänderung, Austritt, Entfernung, Einladungsannahme oder Kontodeaktivierung lösen sofortiges
Re-Rooming bzw. Trennen aus. Globale `io.emit`-Aufrufe bleiben nur für wirklich globale technische
Signale erlaubt.

### 9.2 Push

Push-Nachrichten tragen `group_id` und optional `event_id`. Die Empfängerliste wird bei jedem Versand
aus aktiven Mitgliedschaften, Event-Teilnahme und individuellen Push-Einstellungen berechnet.
Entfernte Mitglieder, Test-User und deaktivierte Konten werden ausgeschlossen.

Eine Person kann Push pro Gruppe und optional pro Event stummschalten. Push-Inhalt und Klickziel
enthalten genug Kontext, damit gleichnamige Events verschiedener Gruppen unterscheidbar sind.

### 9.3 Kiosk

Kiosk-Links gehören entweder zu einem Gruppenraum oder einem Event. Tokens sind zufällig,
widerrufbar, rotierbar und read-only. Ein Event-Kiosk sieht ausschließlich Daten seines Events; ein
Gruppen-Kiosk ausschließlich freigegebene Gruppenraum-Daten. Socket-Subscriptions werden mit
demselben Scope gebunden.

### 9.4 Arcade

Arcade-Lobbys und laufende Matches tragen `group_id` sowie optional `event_id`. Lobbylisten,
Zuschauer-Räume, Quizfragen, Ergebnisse und Kiosk-Streams werden gleich gescoped. Ein Mitglied einer
anderen Gruppe darf eine Lobby weder sehen noch über eine bekannte ID joinen.

Nur die unveränderliche technische Definition der eingebauten Arcade-Titel darf global sein. Sie
enthält weder Spieler-, Gruppen- noch Ergebnisdaten und verleiht keinerlei Sichtbarkeit. Jeder
Arcade-Laufzeitzustand und jede Spielerreferenz erfüllt die Gruppen- und Snapshot-Invarianten aus
Abschnitt 3.6.

---

## 10. Administration, Audit und Löschen

### 10.1 Gruppen-Administration

Gruppen-Admins dürfen innerhalb ihrer Gruppe:

- Einladungen erstellen und widerrufen,
- Mitglieder entfernen und Rollen bis `admin` verwalten,
- Events anlegen, bearbeiten, absagen und archivieren,
- fehlerhafte Matches, Vote-Runden, Auslosungen, Play-Sessions und Durchsagen löschen,
- gruppenbezogene Agent-Schlüssel nicht sehen; der API-Key bleibt Eigentum des Kontos.

Sie dürfen nicht:

- globale Kontopasswörter zurücksetzen, außer ein separater Instanz-Admin erzeugt den bestehenden
  persönlichen Reset-Link,
- Mitgliedschaften oder Daten anderer Gruppen verändern,
- Tracking für andere aktivieren,
- fremde private Kontodaten oder Sessions sehen.

Insbesondere darf ein Gruppen-Admin kein globales Kontopasswort zurücksetzen: Die Übernahme dieses
Kontos würde gleichzeitig Zugriff auf alle anderen Gruppen der Person geben. Account-Recovery bleibt
eine Instanz-Admin- beziehungsweise spätere sichere Self-Service-Funktion. Ein Gruppen-Admin darf
lediglich die betroffene Person aus der eigenen Gruppe entfernen.

### 10.2 Audit

`admin_log` erhält `group_id` und protokolliert Gruppen-, Rollen-, Mitgliedschafts-, Einladungs-,
Event- und Löschaktionen. Gruppen-Admins sehen nur das Audit ihrer Gruppe. Instanzaktionen bleiben in
einem getrennten Scope. Codes, Passwörter, API-Keys und vollständige Push-Inhalte werden nie geloggt.

### 10.3 Datenbesitz und Löschfolgen

- Kontodeaktivierung beendet alle Mitgliedschaften, Sessions, Sockets, Push-Abos und Tracking.
- Gruppenentfernung löscht nicht automatisch historische Gruppenbeiträge.
- Event-Löschung zeigt vorher Anzahl betroffener Matches, Sessions, Turniere, Votes und Nachrichten.
- Gruppenlöschung ist zweistufig: archivieren, danach explizite Hard-Delete-Aktion mit Step-up.
- Referenzierte Personen benötigen für veränderliche Daten eine aktive Mitgliedschaft derselben
  Gruppe; abgeschlossene historische Daten behalten verpflichtend stabile IDs und unveränderliche
  Namens-Snapshots. Es gibt weder gruppenfremde noch namenlose Ergebnis- oder Leaderboard-Zeilen.
- Ein Datenexport pro eigener Gruppe und ein vollständiger Kontoexport sind vor einem öffentlichen
  Betrieb empfehlenswert, aber nicht Voraussetzung für die erste private Mehrgruppen-Version.

---

## 11. Sichere Bestandsmigration

Die Umstellung darf bestehende Daten nicht verlieren und erfolgt in versionierten, wiederholbar
getesteten Migrationen:

1. Tabelle `groups`, Mitgliedschaften, Gruppeneinladungen und neue Rollen anlegen.
2. Eine **Startgruppe** erzeugen, zum Beispiel „RespawnHQ Bestand“.
3. Alle aktiven echten Bestandsspieler als Mitglieder übernehmen. Der erste beanspruchte aktive
   Instanz-Admin wird Owner; weitere bisherige Admins werden Gruppen-Admins.
4. Alle bestehenden Events der Startgruppe zuordnen.
5. Alle bestehenden eventgebundenen Daten über ihr Event der Startgruppe zuordnen.
6. Daten des bisherigen `OUTSIDE_EVENTS_ID` in den Gruppenraum der Startgruppe überführen
   (`event_id = NULL`) und den Sentinel erst entfernen, wenn keine Referenz mehr besteht.
7. Heute globale Fachdaten wie Spiele, Skills, Durchsagen, Info-Einträge, Push-Historie und
   Arcade-Laufzeitdaten der Startgruppe zuordnen. Nur unveränderliche technische
   Arcade-Titeldefinitionen bleiben global.
8. Die bisherige `tracking_paused`-Einstellung in die Gruppen-Einwilligung übersetzen. Für den
   Bestand bleibt das bisherige Verhalten erhalten; neue Gruppen starten privacy-first mit Tracking
   aus.
9. Erst nach vollständigem Backfill `group_id` als Pflichtfeld und Gruppen-Foreign-Keys scharf
   schalten.
10. Alte APIs während einer kurzen Kompatibilitätsphase ausschließlich auf die Startgruppe abbilden;
    danach entfernen, damit kein ungescopter Pfad bestehen bleibt.

Migrationstests benötigen mindestens:

- frische Datenbank,
- reale Legacy-Fixture mit Sentinel- und Eventdaten,
- wiederholten Start ohne doppelte Gruppen/Mitgliedschaften,
- Rollback bei absichtlich fehlschlagendem Backfill,
- Nachweis, dass nach der Migration kein Fachdaten-Datensatz ohne gültige Gruppe existiert.

---

## 12. Sicherheitsbewertung nach OWASP ASVS 5.0.0

Mehrgruppenbetrieb ist echtes Multi-Tenancy. Ein einziger fehlender Gruppenfilter kann Daten einer
anderen Gruppe offenlegen. Deshalb gelten zusätzlich zu den bestehenden Auth-Härtungen:

- Gruppenkontext früh im Request auflösen und an die authentifizierte Person binden.
- Clientseitige IDs nie als Berechtigungsnachweis verwenden.
- Ressourcen immer zusammen mit ihrer Gruppe laden und mutieren.
- Default-deny: neue Routen sind ohne ausdrückliche Datenklasse und Gruppenregel nicht fertig.
- Realtime, Push, Exporte, Kiosk, Dateien und Audit genauso isolieren wie REST.
- Keine ungefilterten „Admin sieht alles“-Queries; Gruppen-Adminrechte sind immer gruppengebunden.
- Cross-Group-Tests für Lesen, Schreiben, Ändern, Löschen, Export, Socket und bekannte Objekt-IDs.
- Gruppen- und Eventkontext in sicherheitsrelevanten Logs führen, ohne sensible Daten zu loggen.

Das entspricht den aktuellen OWASP-Empfehlungen für Tenant Context, Object-Level Authorization und
automatisierte Autorisierungs-Regressionstests:

- [OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP Authorization Regression Testing Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Regression_Testing_Cheat_Sheet.html)
- [OWASP IDOR Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)

SQLite bietet keine native Row-Level Security. Die Isolation liegt deshalb in zentralen Resolvern,
Foreign Keys, zusammengesetzten Eindeutigkeitsregeln und einer vollständigen Testmatrix. Verstreute
handgeschriebene `WHERE group_id = ?`-Checks ohne gemeinsame Zugriffsschicht sind nicht ausreichend.

Verbindliche Sicherheitsbaseline ist der [OWASP Application Security Verification Standard
5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0), **Level 1 und Level 2**. Verweise, Prüflisten und
spätere Abnahmen verwenden ausschließlich versionierte IDs im Format `v5.0.0-x.y.z`; ältere
ASVS-4.x-Nummern werden nicht fortgeschrieben. Damit wird keine formale Zertifizierung behauptet.

ASVS 5.0.0 verschiebt gegenüber 4.0.3 wesentliche Anforderungen. Insbesondere verlangt
`v5.0.0-6.3.3` auf Level 2 MFA oder eine Kombination unabhängiger Authentifizierungsfaktoren. Der
Passwort-Login aus PR #197 erfüllt diese Anforderung noch nicht. MFA und der Breach-Passwort-Check
sind daher verbindliche L2-Lücken und keine optionalen Härtungsideen; bis zu ihrer Umsetzung darf
nur die Erfüllung einzelner Anforderungen, nicht vollständige L2-Konformität behauptet werden.

| Bereich | Stand nach Rev. 4 |
|---|---|
| Passwortregeln und sichere Passwortbedienung | 🟡 Kern in PR #197; Breach-Prüfung nach `v5.0.0-6.2.12` fehlt noch |
| Session-Token, Cookie-Attribute, Logout und absolute Laufzeit | ✅ in PR #197 |
| Mehrfaktor-Authentifizierung | ❌ `v5.0.0-6.3.3` auf Level 2 noch nicht erfüllt |
| Step-up für hochprivilegierte Aktionen | ✅ als Mechanismus; auf Owner-/Gruppenaktionen ausweiten |
| Persönliche Objekt-Autorisierung | ✅ für die bisherigen Required-Auth-Pfade |
| Gruppen-/Tenant-Isolation | ❌ neu zu implementieren; Phasen 5b–5e dürfen nur gemeinsam produktiv freigeschaltet werden |
| Tenant-spezifisches Audit und Offboarding | 🟡 globaler Audit-/Deaktivierungskern vorhanden; Gruppenscope folgt in 5b/5c |
| Asynchrones, kalibriertes scrypt | 🟡 Reihenfolge festgelegt, Benchmark und Umstellung offen |

---

## 13. Umsetzungsplan

Die bisherige Phase 5 war für ein Mehrgruppenmodell zu groß und am falschen Objekt ausgerichtet. Der
neue Plan hält jede Stufe migrations- und reviewbar:

| Phase | Inhalt | Größe |
|---|---|---|
| **0–4 ✅** | Auth-Fundament, feste Session-Identität, Rollen-/Account-Härtung, Onboarding und Required-Auth-Cutover aus PR #197 | erledigt |
| **5a – Gruppenfundament** | `groups`, `group_memberships`, Owner/Admin/Member, Startgruppen-Migration, Gruppenanlage, Einladungsannahme, Gruppenumschalter; Fachdaten verhalten sich noch wie Startgruppe, zweite Produktivgruppe bleibt per Flag gesperrt | L |
| **5b – Zentrale Autorisierung** | `requireGroupMembership`, Gruppenrollen, Ressourcenresolver, Gruppen-/Event-CRUD, sofortige Rollenwirkung, Audit und Cross-Group-Testmatrix | L |
| **5c – Daten-Scoping** | `group_id` auf allen Fachtabellen, Gruppenraum mit `event_id NULL`, vollständiger Backfill, Filter für REST/Export/Analytics, globale Aggregationen entfernen | XL |
| **5d – Tracking & Events** | Gruppenbezogene Agent-Fan-out-Logik, Tracking-Einwilligungen, Event-Zeitfenster, Event-Teilnahme, proratisierte Auswertungen, Session-Abschluss an Grenzen | L–XL |
| **5e – Realtime & öffentliche Flächen** | Socket-Rooms, Live-Rejoin, Push, Kiosk-Token, Arcade-Lobbys/-Ergebnisse, Kontextanzeige und Browser-E2E | L |
| **6 – Betrieb, ASVS-L2-Abschluss & Feinschliff** | MFA, Breach-Passwort-Datenquelle, Gastkonten für einzelne Events, Event-Organizer, Datenexport, Löschfristen, Break-glass-Instanzsupport, optional Datenkorrekturwerkzeuge | M–L |

**Rollout-Regel:** Zwischen 5a und 5e bleibt die Instanz funktional auf genau die migrierte
Startgruppe begrenzt (`MULTI_GROUPS_ENABLED=0`). APIs und UI für zusätzliche Gruppen dürfen in
Entwicklung getestet werden, werden produktiv aber erst freigeschaltet, wenn 5c–5e vollständig
umgesetzt und die Cross-Group-Testmatrix grün ist. So entsteht kein Zeitraum mit nur scheinbarer
Isolation.

### 13.1 Verbindliche Schnittstelle zwischen 5c, 5d und 5e

Die drei Phasen dürfen intern getrennt umgesetzt werden, teilen aber einen verbindlichen Vertrag:

| Übergabe | Verbindlicher Vertrag |
|---|---|
| **5c → 5d** | Jeder Fachdatenzugriff läuft über einen serverseitig aufgelösten `group_id`-/`event_id`-Kontext. Spielerreferenzen liefern aktive Mitgliedschaft oder unveränderlichen historischen Snapshot. Einzige globale Fachdaten-Ausnahme sind unveränderliche Arcade-Titeldefinitionen. |
| **5d → 5e** | Tracking- und Eventänderungen liefern eine bereits autorisierte, gruppengebundene Projektion mit `group_id`, optionalem `event_id`, Spieler-/Mitgliedschaftsnachweis, Consent-Intervall und Zeitgrenze. Es gibt keinen globalen Aktivitätsstrom, den 5e selbst nachträglich filtert. |
| **5c → 5e** | Realtime, Push, Kiosk, Export und Arcade laden Ressourcen und Empfänger über dieselben zentralen Gruppenresolver wie REST. Clientseitige IDs, Socket-Room-Namen oder Kiosk-Token dürfen den Scope nie selbst festlegen oder erweitern. |

5d und 5e dürfen die Persistenzinvarianten aus 5c nicht mit eigenen Parallelabfragen umgehen. 5e
darf nur serverseitig erzeugte, gruppengebundene Projektionen veröffentlichen. Wird ein Vertragsteil
noch nicht erfüllt, bleibt `MULTI_GROUPS_ENABLED=0`; ein phasenweiser Teil-Rollout ist ausgeschlossen.

---

## 14. Verbindliche Testmatrix

Mindestens drei Konten und zwei Gruppen werden in jeder Autorisierungs-Suite verwendet:

- Alice: Owner Gruppe A, Member Gruppe B
- Bob: Member Gruppe A, kein Mitglied Gruppe B
- Carol: Admin Gruppe B, kein Mitglied Gruppe A

Für jede gruppenbezogene Ressourcenart werden geprüft:

- eigenes Gruppenobjekt lesen/schreiben,
- bekannte ID eines fremden Gruppenobjekts lesen/schreiben/löschen → `404`,
- Gruppenrolle vertikal umgehen → `403`,
- `groupId` in Query, Body, URL und Socket-Payload manipulieren,
- Event aus anderer Gruppe referenzieren,
- neue Spielerreferenz ohne aktive Mitgliedschaft sowie historischen Datensatz ohne vollständigen,
  unveränderlichen Spieler-Snapshot anlegen,
- Mitgliedschaft während offener Session/Socket-Verbindung entfernen,
- Admin- oder Ownerrolle während offener Verbindung entziehen,
- Gruppenwechsel in zwei parallelen Browser-Tabs,
- Push- und Kiosk-Empfänger zwischen Gruppen trennen,
- Arcade-Lobby einer fremden Gruppe über bekannte Match-ID joinen,
- globale Arcade-Titeldefinition ändern oder darüber Gruppen-/Spielerdaten einschleusen,
- Agent-Report bei Mitgliedschaft in null, einer und mehreren Gruppen,
- Outside-Tracking-Widerruf und Event-Zeitgrenze,
- parallele Einladungsannahme und Schutz des letzten Owners.

Race-relevante Fälle erhalten `Promise.all`-Integrationstests: Einladung nur einmal annehmen, zwei
Owner-Degradierungen, parallele Eventanlage mit überlappenden Zeiträumen und Mitgliedschaftsentzug
während eines Agent-Reports.

---

## 15. Bereits getroffene Entscheidungen

1. Konto und Spieler bleiben eine Entität.
2. Eine Person kann mehreren Gruppen gleichzeitig angehören.
3. Gruppen sind privat, dauerhaft und die primäre Sicherheitsgrenze.
4. Events gehören genau einer Gruppe und sind zeitlich begrenzt.
5. In Version 1 können nur Gruppenmitglieder an Events teilnehmen.
6. Gruppenrollen sind `owner`, `admin`, `member`; mindestens ein Owner bleibt erhalten.
7. Tracking außerhalb von Events ist pro Gruppe durch die Person steuerbar und für neue Gruppen
   standardmäßig aus.
8. Tracking einer Person kann gleichzeitig in mehreren Gruppen berücksichtigt werden, wenn dort
   jeweils Einwilligung und aktive Mitgliedschaft bestehen.
9. Event-Auswertungen verwenden Gruppen-Tracking innerhalb des Eventzeitraums statt duplizierter
   Event-Trackingzeilen.
10. Gruppen-Admins dürfen Tracking für andere nicht aktivieren.
11. Der bisherige Sentinel wird durch `group_id + event_id NULL` ersetzt.
12. Gruppenübergreifende Profile, Spielelisten, Ranglisten und Auswertungen entfallen.
13. Neue produktive Gruppen werden erst nach vollständiger technischer Isolation freigeschaltet.
14. Jedes beanspruchte echte Konto darf eine Gruppe anlegen und wird ihr erster Owner; eine
    Instanz-Adminrolle ist dafür weder nötig noch in Gruppendomänen ein Berechtigungsersatz.
15. Event-Einladungen werden aktiv angenommen; erst die Annahme gewährt Event-Sichtbarkeit und kann
    eine persönliche Event-Tracking-Zustimmung tragen.
16. Tracking-Widerruf stoppt zukünftige Erfassung; rechtmäßig erfasste Historie bleibt erhalten und
    wird nur durch eine separate bewusste Löschaktion entfernt.
17. Ehemalige Mitglieder verlieren jeden aktuellen Gruppenzugriff; ihre historischen Beiträge
    bleiben mit unveränderlichem Spieler-Snapshot erhalten.
18. Profilname und Avatar sind in Version 1 global; ein optionaler Gruppen-Anzeigename ist später
    möglich.
19. Überlappende veröffentlichte Events derselben Gruppe sind in Version 1 verboten; Entwürfe dürfen
    sich überschneiden.
20. Alle Spielerreferenzen benötigen eine aktive Mitgliedschaft derselben Gruppe oder einen
    unveränderlichen historischen Snapshot. Nur unveränderliche globale Arcade-Titeldefinitionen
    sind von der allgemeinen Gruppenscope-Pflicht ausgenommen.
21. Sicherheitsbaseline ist OWASP ASVS 5.0.0 auf Level 1 und Level 2; vollständige
    L2-Konformität darf erst nach MFA und Breach-Passwort-Prüfung behauptet werden.

## 16. Noch offene Produktentscheidungen

1. **Aufbewahrungsfrist nach Gruppenlöschung:** Für privaten Start manuell; vor breiter öffentlicher
   Nutzung feste Frist und Export ergänzen.
2. **Breach-Passwort-Datenquelle:** Verbindlich ist die Prüfung nach `v5.0.0-6.2.12`; vor Phase 6
   wird zwischen HIBP-k-Anonymity mit lokalem Ausfallkonzept und einer lokal aktualisierten Liste
   entschieden. Dauerhaftes Fail-open ist ausgeschlossen.
3. **MFA-Verfahren:** `v5.0.0-6.3.3` ist für Level 2 verbindlich. Vor Phase 6 wird zwischen Passkeys
   und einem für den privaten LAN-Betrieb geeigneten zweiten Faktor entschieden; reiner
   Passwort-Login darf nicht als vollständig L2-konform bezeichnet werden.
