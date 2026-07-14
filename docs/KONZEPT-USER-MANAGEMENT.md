# Konzept: Richtiges User-Management (Login, Rollen, Event-Sichtbarkeit)

Stand: Juli 2026 · Status: **Entwurf zur Diskussion** (Rev. 2 – mit Detail-Review, Edge Cases
und Auth-Entscheidung)

Dieses Dokument beschreibt, wie aus dem heutigen „Jeder darf alles, Identität ist Ehrensache"-Modell
ein echtes User-Management wird: persönlicher Login, feste Identität, Admin-Rolle mit Moderations-
rechten, Test-User-Impersonation und Events, die nur ihre eingeladenen Teilnehmer sehen. Rev. 2
ergänzt die Detailprüfung: Authentifizierungs-Entscheidung (Abschnitt 5), Rollen-/Rechte-Matrix
(Abschnitt 6), Bewertung des Sentinel-Modells „immer laufendes Event" (Abschnitt 7) und einen
Edge-Case-Katalog für Anzeige & Auswertungen (Abschnitt 8), jeweils am realen Code festgemacht.

---

## 1. Ist-Zustand (was heute wirklich da ist)

Wichtig fürs Konzept: Vieles ist schon näher am Ziel, als man denkt – aber an drei Stellen fehlt
das Fundament komplett.

### 1.1 Zugang & Identität

| Baustein | Heute | Bewertung |
|---|---|---|
| Zugangsschutz | **Ein** geteilter Access-Token für alle (`x-access-token`, im Einladungslink als `?token=`) | Hält Fremde raus, unterscheidet aber niemanden |
| Identität | `whoami.js`: jedes Gerät merkt sich per `localStorage`, „wer es ist" – frei wählbar, jederzeit per „Nicht du?" wechselbar. Viele POST-Bodies und sogar Lese-Endpoints (z. B. `GET /api/digest?playerId=`) nehmen die `playerId` ungeprüft vom Client | Reines Vertrauensmodell; genau das soll wegfallen |
| Admin | Die Admin-PIN ist faktisch stillgelegt (Default leer = offener Modus), und eine Migration hat bewusst **alle Bestandsspieler zu Admins gemacht**; neue Spieler starten ebenfalls als Admin (siehe `migrateAllPlayersAdminBackfill` in `db.ts` und `docs/KONZEPT-TEST-USER.md`) | Rolle existiert als Spalte, ist aber flächendeckend vergeben und damit bedeutungslos – beim Scharfschalten echter Rollen müssen die Alt-Flags zurückgesetzt werden (siehe 4.3/Phase 3) |
| Agent | Pro Spieler ein eigener `api_key` (steckt im personalisierten ZIP) | Bleibt unverändert – das ist bereits „echte" Geräte-Auth |
| Socket.IO | Prüft nur den geteilten Access-Token | Muss künftig die User-Session prüfen |

### 1.2 Event-Scoping der Daten

Die Datenbank ist bereits weitgehend event-fähig: **16 Tabellen** tragen ein `event_id`
(Votes, Vote-Runden, Matches, Auslosungen, Turniere, Play-Sessions, Sitznachbarn, Sitzplan,
Pings, Drafts, Sammelbestellungen, Anreisen, Fahrgemeinschaften …). Der Sentinel
`OUTSIDE_EVENTS_ID` („Außerhalb von Events") fängt alles auf, was ohne getracktes Event passiert.

Das heutige Zuordnungs-Muster ist überall gleich: **Schreibpfade** taggen mit
`getTrackingEventId()` (also „welches Event trackt gerade", sonst Sentinel), **Lesepfade**
nehmen einen optionalen `?eventId=`-Filter, der ungeprüft übernommen wird. Der Agent-Report ist
die einzige Stelle, die schon Mitgliedschaft beachtet: Wer nicht auf der Teilnehmerliste des
trackenden Events steht, wird gar nicht erfasst (`routes/agent.ts`).

**Aber:** Das Scoping ist heute nur eine *Ablage-Dimension*, keine *Sichtbarkeits-Grenze* –
jeder sieht alle Events und alle Daten. Und ein paar Tabellen sind noch gar nicht event-bezogen:

- `broadcasts` (Durchsagen) – gehen an **alle** Geräte/Push-Abos
- `info_entries` (Info-Board: WLAN, Links …) – global
- `push_log` (Push-Historie für den Kiosk), `arcade_results` – global
- Push-Versand (`notifyPlayers`) kennt keine Event-Grenze
- „Genau eine laufende Abstimmung" und „genau ein aktiver Draft" sind **globale** Guards,
  nicht pro Event

### 1.3 Löschen / Moderation

DELETE-Endpoints existieren bereits für Spiele, Spieler, Matches, Turniere, Info-Einträge,
Quiz-Fragen u. a. – aber im LAN-Trust-Modell darf sie **jeder** aufrufen. Es fehlen außerdem
Lösch-Wege für Vote-Runden(-Historie), Auslosungs-Historie (`matchmaking_draws`) und einzelne
Play-Sessions.

### 1.4 Bug: Event-Anlage geht nicht

Gefunden und im Zuge dieses Branches gefixt: `server/public/js/views/games.js` benutzt
`openModal` (Event-Formular, Teilnehmer-Dialog, Share-Modal), hatte aber nur `confirmDialog`
importiert. Der Klick auf „+ Event" warf deshalb einen `ReferenceError` und es passierte –
aus Nutzersicht – einfach nichts. Der Fix ist ein Einzeiler (Import ergänzt); Backend-Route
und Formular waren in Ordnung.

---

## 2. Zielbild

1. **Jede Person hat ein Konto** (= der bestehende `players`-Datensatz, erweitert um
   Login-Daten). Ein Gerät ist nach einmaligem Login dauerhaft diese Person.
2. **Identität ist nicht mehr wechselbar.** „Nicht du?" verschwindet; wer ein anderes Konto
   nutzen will, braucht dessen Passwort (Logout bleibt für geteilte Geräte möglich).
3. **Zwei Rollen:** `admin` und `user`. Admin-Rechte werden **serverseitig** an der Session
   geprüft, nicht mehr per geteilter PIN.
4. **Event-Sichtbarkeit:** Normale User sehen globale Stammdaten + „Außerhalb von Events" +
   nur die Events, in denen sie Teilnehmer sind. Admins sehen alles.
5. **Admins moderieren:** Datensätze löschen (Spieler, Spiele, Turniere, Auslosungen,
   Ergebnisse, Vote-Runden …), Test-User anlegen und **als Test-User agieren**
   (Impersonation mit sichtbarem Banner).
6. **Pro Event „alles nochmal":** Sitzplan, Abstimmung, Turniere, Sitznachbarn, Durchsagen,
   Push-Nachrichten usw. wirken nur innerhalb des Events und erreichen nur dessen Teilnehmer.

---

## 3. Ergänzungen & Korrekturen zu den ursprünglichen Ideen

Die Ideen aus der Anfrage sind alle machbar – an diesen Stellen empfehle ich Präzisierungen:

1. **„User" nicht als neue Entität bauen, sondern `players` erweitern.** Ein separates
   User-Objekt mit Verknüpfung zum Spieler würde jede Route, jedes Frontend-Stück und die
   ganze Agent-Logik doppelt verkomplizieren. Spieler *ist* das Konto: `players` bekommt
   `password_hash`, `is_test`, Sessions hängen direkt am Spieler. (Der Agent-`api_key` bleibt
   davon unberührt.)
2. **Passwort ja – aber die Hürde klein halten.** Produktziel Nr. 2 ist „Handy raus, URL auf,
   loslegen". Deshalb: Registrierung nur über **Einladungslink mit Einmal-Code** (ersetzt den
   heutigen geteilten Token-Link), Passwort mit milden Regeln (min. 8 Zeichen, keine
   Sonderzeichen-Pflicht), **lange Sessions** (~90 Tage, gleitend verlängert) – man loggt sich
   pro Gerät praktisch einmal ein und ist die ganze LAN (und die nächste) drin. Details und
   verworfene Alternativen: Abschnitt 5.
3. **„Nicht mehr wechseln" heißt nicht „kein Logout".** Logout muss bleiben (geteilte Geräte,
   Familien-Tablet als Kiosk …). Was wegfällt, ist der *passwortlose* Wechsel auf eine fremde
   Identität.
4. **Impersonation nur auf Test-User beschränken.** Wenn Admins sich in *jeden* User verwandeln
   könnten, könnte ein Admin unbemerkt als echter Freund abstimmen/bestellen/schreiben – das
   vergiftet das Vertrauen in alles, was das Tool anzeigt. Die Spalte `players.is_test`
   existiert bereits (Test-User-Feature, `docs/KONZEPT-TEST-USER.md`); „Als dieser User
   agieren" geht **nur** bei `is_test = 1`. Während der
   Impersonation zeigt das UI dauerhaft einen Banner („Du agierst als Test 3 – zurück zu dir"),
   und Test-User bekommen nie Push-Nachrichten.
5. **Event-Anlage und Event-Verwaltung werden Admin-Funktionen.** Bisher stand das allen offen
   (Trust-Modell). Sobald Events Sichtbarkeitsgrenzen sind, muss kontrolliert sein, wer sie
   anlegt und wer die Teilnehmerliste bestimmt – sonst ist die Grenze wertlos. (Der Bug, dass
   die Anlage gar nicht ging, ist unabhängig davon bereits gefixt, siehe 1.4.)
6. **„Eingeladen werden" = auf der Teilnehmerliste stehen.** Kein zusätzlicher
   Einladungs-Workflow mit Annehmen/Ablehnen – der Admin setzt die Teilnehmerliste
   (`event_participants`, gibt es schon), und damit ist das Event für diese Personen sichtbar.
   Optional später: Benachrichtigung „Du wurdest zu LAN Winter 2027 hinzugefügt".
7. **Parallele Events bleiben die Ausnahme, nicht der Bauplan.** Es bleibt bei „höchstens ein
   Event trackt gleichzeitig". Aber die Guards „eine laufende Abstimmung / ein aktiver Draft"
   werden von global auf **pro Event** umgestellt, damit z. B. ein schon angelegtes nächstes
   Event nicht mit dem laufenden kollidiert.
8. **Kiosk braucht eine eigene Lösung.** Der TV an der Wand kann sich nicht als Person
   einloggen. Vorschlag: pro Event generierbarer **Read-only-Kiosk-Link** (eigener Token, nur
   GET auf die Kiosk-Daten dieses Events).
9. **HTTPS wird Pflicht statt Empfehlung.** Der Server ist aus der Cloud erreichbar; sobald
   echte Passwörter fließen, müssen sie verschlüsselt transportiert werden. (Für Web-Push ist
   HTTPS ohnehin schon nötig, das Deployment kann das also bereits.)

---

## 4. Konzept im Detail

### 4.1 Konten, Passwörter, Sessions

**Schema-Erweiterungen:**

```sql
ALTER TABLE players ADD COLUMN password_hash TEXT;          -- NULL = Konto noch nicht beansprucht
ALTER TABLE players ADD COLUMN last_login_at INTEGER;
ALTER TABLE players ADD COLUMN deactivated_at INTEGER;      -- Ex-Mitspieler: siehe 8.4
-- players.is_test existiert bereits (Test-User-Feature)

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,          -- nanoid
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,      -- SHA-256 des Session-Tokens (Token selbst nie speichern)
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  -- Test-User-Impersonation: gesetzt = diese (Admin-)Session agiert gerade als
  -- der referenzierte Test-User. ON DELETE SET NULL: wird der Test-User
  -- gelöscht, fällt die Session automatisch auf den Admin selbst zurück.
  acting_as    TEXT REFERENCES players(id) ON DELETE SET NULL
);

CREATE TABLE invites (
  code        TEXT PRIMARY KEY,          -- nanoid, Einmal-Code
  purpose     TEXT NOT NULL,             -- 'register' | 'claim' | 'reset' (siehe unten)
  player_id   TEXT REFERENCES players(id) ON DELETE CASCADE, -- gesetzt bei claim/reset
  event_id    TEXT REFERENCES events(id) ON DELETE CASCADE,  -- optional: direkt in dieses Event
  created_by  TEXT REFERENCES players(id), -- NULL = System (Recovery-Bootstrap, s. 4.3)
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER,                   -- Empfehlung: Default 14 Tage
  revoked_at  INTEGER,                   -- Admin kann Codes zurückziehen
  used_at     INTEGER,
  used_by     TEXT REFERENCES players(id)
);
```

**Warum Codes einen `purpose` brauchen:** Claim- und Reset-Links teilen sich zwar den
Mechanismus, dürfen aber nicht dieselbe Sorte Code sein. Sonst gilt entweder „Claim geht auch
auf beanspruchte Konten" – dann wird jeder alte, noch nicht abgelaufene Claim-Link nachträglich
zum Passwort-Reset-Generalschlüssel für das Konto – oder Claim lehnt beanspruchte Konten ab,
und der dokumentierte Reset-Flow funktioniert gar nicht. Deshalb: `claim`-Codes gelten nur für
unbeanspruchte Konten und **alle** offenen Claim-Codes eines Spielers werden beim erfolgreichen
Claim entwertet; `reset`-Codes gelten nur für beanspruchte Konten, und Passwortänderung/-reset
entwertet alle offenen Reset-Codes des Kontos.

**Passwort-Hashing:** `crypto.scrypt` aus Node-Bordmitteln (Format `scrypt$N$r$p$salt$hash`).
Kein neues natives Paket, kein Build-Risiko – bewusst gegen `bcrypt`/`argon2`-Dependencies
entschieden. Für 15 Nutzer auf LAN-Hardware ist scrypt mit Standardparametern mehr als genug.

**Session-Mechanik:**
- Login liefert einen zufälligen Token (256 bit), gespeichert wird nur dessen Hash.
- Transport als **HTTP-only-Cookie** (`SameSite=Lax`, `Secure`): funktioniert automatisch für
  `fetch`, Socket.IO-Handshake **und** den Service Worker (Web-Push-Setup), ohne dass das
  Frontend Token-Handling betreiben muss. Der bisherige `x-access-token`-Header entfällt.
- Lebensdauer ~90 Tage, `last_seen_at` gleitend aktualisiert; Logout löscht die Session-Zeile.
- Passwortänderung invalidiert alle anderen Sessions des Kontos.
- Login-Endpoint mit einfachem Rate-Limit (siehe 5.3) gegen Durchprobieren.

**Neue Endpoints:**

| Endpoint | Zweck |
|---|---|
| `POST /api/auth/register` | Neues Konto über Invite-Code (`code`, `name`, `password`, Avatar/Farbe) |
| `POST /api/auth/claim` | Bestandsspieler-Konto beanspruchen (`code`, `password`) |
| `POST /api/auth/login` | `name` + `password` → Session-Cookie |
| `POST /api/auth/logout` | Session beenden |
| `GET  /api/me` | Eigenes Profil + Rolle + ggf. Impersonations-Status |
| `POST /api/auth/password` | Eigenes Passwort ändern |

**Race-Sicherheit (gemäß CLAUDE.md-Regel):** Registrierung mit gleichem Namen, doppeltes
Einlösen desselben Invite-Codes und paralleles Claim desselben Spielers sind klassische
Check-dann-Schreiben-Muster → expliziter Guard (UNIQUE-Constraints + Transaktion, zweiter
Request bekommt `409`) und Tests in `api.concurrency.test.ts`.

### 4.2 Frontend: Login statt „Wer bist du?"

- Neuer **Login-/Registrierungs-Screen** als Gate vor der App (ersetzt die heutige
  Token-Abfrage). Einladungslink `/?invite=CODE` springt direkt in die Registrierung mit
  vorausgefülltem Code – der „Handy raus, loslegen"-Flow bleibt also ein einziger Link/QR-Code.
- `whoami.js` wird ersatzlos entfernt; überall, wo heute `getMyId()` gelesen wird
  (Voting, Live-Pause, Skills, Bestellungen, Pings, Arcade …), kommt die Identität aus
  `GET /api/me` (einmal beim App-Start in den `state`). Serverseitig wird `player_id` aus der
  Session genommen und **nicht mehr aus dem Request akzeptiert** – das gilt auch für
  Lese-Endpoints wie `GET /api/digest?playerId=` und die persönlichen Statistiken, die heute
  jede beliebige `playerId` beantworten.
- Profil-Screen behält Name/Avatar/Farbe-Bearbeitung (nur fürs eigene Konto) und bekommt
  „Passwort ändern" + „Abmelden".

### 4.3 Rollen & Durchsetzung

- `requireAdmin` prüft künftig die **Session-Rolle** (`players.is_admin` des eingeloggten
  Users) statt der PIN. Die PIN und der ganze Unlock-Flow im Admin-View entfallen.
- **Alt-Flags zurücksetzen (kritisch):** Heute sind per Migration **alle** Bestandsspieler
  Admins, und neue Spieler starten als Admin (1.1). Ohne Reset wären sämtliche neuen Gates
  No-ops – jedes beanspruchte Konto wäre ja Admin. Beim Scharfschalten der Rollen (spätestens
  mit `AUTH_MODE=required`) werden deshalb alle `is_admin`-Flags zurückgesetzt und Admins
  explizit neu bestimmt; neue Spieler starten ab dann als normale User.
- **Bootstrap ohne Deadlock:** Registrieren/Claim brauchen einen Invite-Code, Codes erzeugen
  können nur Admins, und Admin wird man erst durch Registrieren/Claim – auf einer frischen DB
  (oder nach dem Flag-Reset ohne vorbereitete Links) wäre das ein Henne-Ei-Lockout. Zwei
  Auswege, beide Teil des Konzepts: (1) Die Cutover-Checkliste verlangt, dass die Claim-Links
  **vor** dem Umschalten auf `AUTH_MODE=required` erzeugt werden – das passiert noch im
  Legacy-Modus, in dem heute jeder Admin ist. (2) `POST /api/auth/register`/`claim`
  akzeptieren den `ADMIN_RECOVERY_CODE` aus der Server-Config als Invite-Ersatz, solange kein
  beanspruchtes Admin-Konto existiert; das so erstellte Konto wird Admin (dafür ist
  `invites.created_by` nullable – Systemvorgang ohne menschlichen Ersteller). Damit gibt es
  in keinem Zustand – frische DB eingeschlossen – keinen Weg hinein.
- **Bootstrap-Regel:** Nach dem Reset wird das erste erfolgreich registrierte/beanspruchte
  Konto automatisch Admin (typisch: der Betreiber claimt zuerst und verteilt dann die Links).
  `ADMIN_RECOVERY_CODE` dient außerdem als Fallback für „einziger Admin hat sein Passwort
  vergessen".
- Die vollständige Rechte-Matrix und die Sonderfälle (letzter Admin, Selbst-Degradierung,
  Test-User-Regeln) stehen in Abschnitt 6.

### 4.4 Event-Sichtbarkeit

**Grundregel:**

| Datenart | Sichtbar für |
|---|---|
| Stammdaten: Spieler(-Profile), Spiele, Skills, Bock | alle eingeloggten User (bewusst global – „gleiche Truppe jedes Jahr") |
| „Außerhalb von Events" (`OUTSIDE_EVENTS_ID`) | alle eingeloggten User |
| Event-Daten (Votes, Turniere, Sitzplan, Bestellungen, Durchsagen, …) | Teilnehmer des Events + Admins |
| Event-Liste | Admins: alle · User: nur eigene Events (+ Sentinel) |
| Event-übergreifende Aggregationen (Leaderboard, Hall of Fame) | alle eingeloggten User – Details und Grenzfälle in Abschnitt 8 |

**Umsetzung serverseitig (zentral, nicht pro Route improvisiert):**
- Ein Middleware-Paar in `auth.ts`: `requireUser` (Session → `req.player`) und
  `requireEventAccess` (löst die `event_id` des Requests auf – aus Query, Body oder der
  referenzierten Ressource – und prüft Mitgliedschaft/Admin; sonst `404`, nicht `403`,
  damit die Existenz fremder Events nicht durchsickert).
- Zwei zentrale Helfer in `events.ts` (Begründung in Abschnitt 7):
  - `getEventContextFor(playerId)` – in welches Event schreibt eine Aktion dieses Users:
    das trackende Event, **wenn er Teilnehmer ist**, sonst der Sentinel. Ersetzt die heutigen
    direkten `getTrackingEventId()`-Aufrufe in allen Schreibpfaden.
  - `getEventAudience(eventId)` – wen erreichen Push/Broadcast/Realtime dieses Events:
    bei echten Events die aktive Teilnehmerliste; beim Sentinel alle aktiven Nicht-Test-User
    **abzüglich** der Teilnehmer eines gerade trackenden Events und abzüglich deaktivierter
    Konten. Der Abzug ist wichtig: Startet ein Nicht-Mitglied während einer laufenden LAN eine
    Sentinel-Abstimmung oder -Durchsage, dürfen die Event-Teilnehmer davon keine Push/Toasts
    bekommen – sonst blutet die Sentinel-Welt in die Event-Welt hinein. (Nur die
    Live-Zustellung ist so beschnitten; *lesen* dürfen Sentinel-Daten weiterhin alle.)
- List-Endpoints mit Event-Filter (`/api/events`, Historien, Analytics, Export) validieren
  ein übergebenes `?eventId=` gegen die Mitgliedschaft, statt es ungeprüft in die Query zu
  stecken; Default ist der Kontext des Users, nicht blind das trackende Event.
- **Socket.IO-Rooms:** Beim Connect joint der Socket `global` + `event:<id>` für jede eigene
  Mitgliedschaft. `broadcast()` bekommt einen optionalen Event-Scope; alle event-bezogenen
  Realtime-Events (Votes, Turnier, Draft, Sitzplan, Durchsagen, Bestellungen …) senden nur
  noch in ihren Room. Admin-Sockets joinen zusätzlich alle Rooms. Ändert sich eine
  Teilnehmerliste **oder eine Rolle** (Admin entzogen = sofort raus aus fremden Event-Rooms,
  Admin erteilt = rein), joint/verlässt der Server die betroffenen Sockets sofort – nicht
  erst beim Reconnect, sonst überlebt die alte Room-Mitgliedschaft in jedem offenen Tab.
- **Push:** `notifyPlayers()` schneidet die Empfängerliste über `getEventAudience()` zu
  (heute: alle Abos). Test-User werden nie angeschrieben.
- **Kiosk:** `GET /kiosk.html?k=<kioskToken>` – pro Event generierbarer Read-only-Token
  (eigene kleine Tabelle oder Spalte an `events`), der nur die Kiosk-Aggregat-Endpoints darf.

**Restliche Scoping-Lücken schließen:** `broadcasts`, `info_entries` und `push_log` bekommen
ein `event_id` (Info-Board: pro Event **plus** globale Einträge, denn „WLAN-Passwort" ist
ortsgebunden, „Discord-Link" eher global – gelöst über `event_id NULL` = global sichtbar;
`push_log` braucht das Scoping, damit der Kiosk eines Events nur „seine" Push-Historie zeigt).
`arcade_results` bekommt `event_id` für saubere Event-Auswertungen. Die Guards „eine laufende
Abstimmung"/„ein aktiver Draft" wandern von global auf pro Event (Key im `app_state` bzw.
Draft-Query um `event_id` erweitern) – inklusive neuer Concurrency-Tests. Schema-Detail
dabei: `vote_rounds.round` ist heute ein **globaler** Schlüssel, an dem Votes und Ergebnisse
hängen. Die globale Runden-Sequenz bleibt deshalb bestehen (zwei parallel laufende Runden
belegen nie dieselbe Nummer – kein Kollisions- oder Vermischungsrisiko in den
Ergebnis-Queries), nur der „laufende Runde"-Zeiger im `app_state` wird pro Event geführt;
die Historie filtert wie bisher über `event_id`.

### 4.5 Admin-Moderation

- **Löschen:** Bestehende DELETE-Endpoints (Spieler, Spiele, Matches, Turniere, Info-Einträge,
  Quiz-Fragen) hinter `requireAdmin`; neu dazu kommen `DELETE` für Vote-Runden,
  Auslosungs-Historie (`matchmaking_draws`), einzelne Play-Sessions und Durchsagen.
  Alles mit Bestätigungsdialog im UI. Die Auswirkungen auf Historie und Auswertungen
  (Kaskaden, verwaiste Ergebnis-Snapshots) sind nicht trivial – siehe 8.4.
- **Audit-Log (klein, aber wertvoll):** eine simple `admin_log`-Tabelle
  (wer, was, wann, Ziel-ID) für Löschungen, Rollenänderungen und Impersonations-Starts.
  Kein UI-Aufwand nötig – zunächst reicht, dass es nachvollziehbar in der DB steht.
- **Test-User:** Seeding mit `is_test = 1` samt Ausblendung außerhalb des Admin-Modus
  existiert bereits (`testUsers.ts`, `docs/KONZEPT-TEST-USER.md`). Neu dazu kommen: Ausschluss
  aus Push/Digest und Aggregationen (8.5) und die Regel, dass Test-User nie Admin werden
  können.
- **Impersonation:** `POST /api/admin/impersonate/:playerId` (nur `is_test`-Ziele) setzt
  `acting_as` auf der **eigenen** Admin-Session; `POST /api/admin/impersonate/stop` setzt es
  zurück. Kein zweites Cookie, keine zweite Session – dadurch gibt es keinen „hängenden"
  Zustand: Läuft die Admin-Session ab oder wird der Test-User gelöscht (`ON DELETE SET NULL`),
  ist der Admin automatisch wieder er selbst. Effektive Identität = `acting_as ?? player_id`;
  **effektive Rechte = die des Test-Users** (nie Admin, auch nicht „geerbt"). `GET /api/me`
  liefert beide Identitäten, das UI zeigt den permanenten Banner. Eine bewusste Ausnahme von
  der Rechte-Regel: `impersonate/stop` (und die Impersonations-Felder in `/api/me`)
  autorisieren gegen den **Session-Inhaber** (`player_id`), nicht gegen die effektive
  Identität – ein stumpfes `requireAdmin` auf die effektiven Rechte würde den Admin sonst im
  Test-User-Zustand einsperren (kein Weg zurück außer Logout). Start und Stop stoßen
  außerdem dasselbe sofortige Socket-Re-Rooming an wie Rollen-/Roster-Änderungen (4.4) –
  ein bereits offener Admin-Tab darf nach dem Wechsel in den Test-User nicht in allen
  Event-Rooms hängen bleiben und dort Realtime-Daten empfangen, die der Test-User nicht
  sehen dürfte.

### 4.6 Migration bestehender Daten & sanfte Umstellung

Bestandsspieler haben Profile, Skills, Historie – nichts davon geht verloren:

1. **Schema-Migration** (idempotent, wie die bestehenden Migrationen in `db.ts`): neue Spalten
   und Tabellen, `password_hash` bleibt `NULL`.
2. **Claim-Flow:** Der Admin erzeugt pro Bestandsspieler einen Claim-Link (Invite mit
   `player_id`) und verschickt ihn (WhatsApp/Discord). Erster Klick → Passwort setzen → Konto
   gehört der Person. Neue Leute kommen über normale Invite-Links rein.
3. **Feature-Flag `AUTH_MODE`:** `legacy` (heutiges Verhalten, Default bis alles fertig ist) →
   `required` (Login Pflicht). Damit lässt sich jede Phase einzeln mergen und auf der
   nächsten Session testen, ohne einen Big-Bang-Umstieg. Der geteilte Access-Token und die
   Admin-PIN werden erst entfernt, wenn `required` stabil läuft.
4. **Agent bleibt kompatibel:** `api_key`-Auth der Agents ist von allem hier unabhängig –
   niemand muss den Agent neu herunterladen.

### 4.7 Tests

Gemäß Projektregeln pro Phase:
- **Unit/Integration:** Auth-Flows (Register/Claim/Login/Logout/Passwort), Rollen-Gates
  (User vs. Admin vs. anonym), Sichtbarkeits-Matrix (Mitglied/Nicht-Mitglied/Admin je
  Ressourcentyp), Impersonations-Regeln (nur Test-User, keine Admin-Rechte, Banner-Daten in
  `/api/me`), Kontext-Regel aus 7.2 (Nicht-Mitglied schreibt in Sentinel, nicht ins Event).
- **Concurrency (`api.concurrency.test.ts`):** doppelte Registrierung desselben Namens,
  doppeltes Einlösen eines Invite-Codes, paralleles Claim, parallele Vote-Runden-Starts in
  **zwei verschiedenen** Events (müssen beide klappen) vs. im selben Event (einer gewinnt),
  paralleles „letzten Admin degradieren" (einer gewinnt, der Zustand „0 Admins" ist unmöglich).
- **E2E (Playwright):** Login-Gate, Invite-Link-Onboarding, „User sieht fremdes Event nicht",
  Admin löscht Turnier, Impersonation mit Banner und Rückkehr.

---

## 5. Authentifizierung: Entscheidung im Detail

### 5.1 Verglichene Varianten

| Variante | Bewertung |
|---|---|
| **Name + Passwort, Session-Cookie** ✅ Empfehlung | Selbsterklärend für alle, kein Zusatz-Infrastruktur-Bedarf, neues Gerät jederzeit ohne Admin-Hilfe. Nachteil „Passwort-Nerv" wird durch 90-Tage-Sessions und Invite-Onboarding fast vollständig neutralisiert |
| Personalisierter Geräte-Link ohne Passwort („Link = Konto") | Verlockend einfach, aber: jedes neue Gerät braucht den Admin, ein weitergeleiteter/abfotografierter Link ist ein vollwertiger Konto-Zugang, und Links landen erfahrungsgemäß in Gruppenchats. Als *Onboarding* (Invite/Claim-Link) übernehmen wir genau diese UX – nur eben mit einmaligem Passwort-Setzen dahinter |
| PIN pro User (4–6 Ziffern) | Auf einem aus der Cloud erreichbaren Server trivial durchprobierbar; Rate-Limits dagegen zu bauen ist mehr Aufwand als ein echtes Passwort |
| Magic-Link per E-Mail | Auch **mit** aufgebauter Mail-Infrastruktur nicht empfohlen – Begründung unten (5.1.1) |
| Passkeys / WebAuthn | Technisch die schönste Lösung (nichts zu merken, nicht phishbar), aber: an die Domain gebunden (Umzug des Servers = alle Passkeys weg), Gerätewechsel/-verlust braucht Recovery-Pfad, spürbar mehr Implementierungs- und Erklär-Aufwand. **Als optionaler zweiter Login-Weg später nachrüstbar**, da die Session-Schicht identisch bleibt |

#### 5.1.1 Warum Magic Links auch mit eigener Mail-Infrastruktur nicht gewinnen

Die naheliegende Einwand-Umkehr („dann bauen wir eben Mail-Versand") wurde geprüft. Die
Ablehnung hängt aber nicht an der fehlenden Infrastruktur, sondern an drei strukturellen
Punkten:

1. **Der Login passiert im zeitkritischsten Moment.** Eingeloggt wird fast nur, wenn jemand
   auf der Party ein neues/geliehenes Gerät einrichtet. Genau dann hinge der Zugang an
   Party-WLAN → Mailprovider → Spamfilter → Zustell-Latenz. Passwort-Login ist sofort da und
   hat null externe Abhängigkeiten – das zahlt direkt auf Produktziel Nr. 1 ein
   („läuft 3 Tage durch, ohne dass jemand eingreifen muss").
2. **Zustellbarkeit ist Dauerbetrieb, kein Einmal-Aufwand.** Selbst gehosteter SMTP landet
   zuverlässig im Spam; realistisch bräuchte es einen Transaktions-Mail-Dienst samt
   Absender-Domain, SPF/DKIM und API-Key – laufende Wartung und ein zusätzlicher Single Point
   of Failure während der LAN, für ein Tool mit ein paar Einsatz-Wochenenden pro Jahr.
   Zusätzlich müssten erstmals Mail-Adressen aller Mitspieler erhoben und gepflegt werden.
3. **Der Nutzen wäre minimal, weil das Konzept die Magic-Link-UX schon fast hat.** Onboarding
   und „Passwort vergessen" laufen ohnehin über personalisierte Einmal-Links (Invite/Claim/
   Reset) – verteilt über WhatsApp/Discord, wo sich die Gruppe zuverlässiger erreicht als per
   Mail. Mit 90-Tage-Sessions tippt jede Person ihr Passwort pro Gerät grob einmal im Jahr;
   Magic Links würden also einen praktisch nie auftretenden Schritt wegoptimieren.

Falls „nichts merken müssen" später doch gewünscht ist, ist der bessere zweite Schritt
**Passkeys** (keine externe Abhängigkeit, offline-fähig, auf derselben Session-Schicht
nachrüstbar), nicht Mail.

### 5.2 Transport & Browser-Integration

- **Cookie:** `HttpOnly`, `SameSite=Lax`, `Secure`, Pfad `/`. `SameSite=Lax` blockt
  Cross-Site-POSTs, damit ist CSRF für die JSON-API praktisch abgedeckt (zusätzlich: Server
  akzeptiert nur `Content-Type: application/json`).
- **Betrieb ohne HTTPS** (reines LAN ohne Cloud): `Secure`-Cookies funktionieren dann nicht.
  Dafür ein explizites Config-Flag `COOKIE_SECURE=0` mit dickem Log-Warnhinweis – Default
  bleibt sicher.
- **Socket.IO** authentifiziert im Handshake über dasselbe Cookie. Logout/Passwortwechsel
  trennt aktiv alle Sockets der betroffenen Session(s), sonst lebt eine „tote" Session im
  offenen Tab weiter.
- **Web-Push:** `push_subscriptions` hängt an `player_id`. Wichtiger Edge Case auf geteilten
  Geräten: meldet sich User A ab und User B an, zeigt das Gerät sonst weiter A's
  Push-Nachrichten. Deshalb löscht Logout die Push-Subscription dieses Geräts (Client ruft
  `pushManager.getSubscription().unsubscribe()` auf und meldet den Endpoint am **bestehenden**
  `POST /api/push/unsubscribe` ab), und nach Login wird neu abonniert.
- **Kiosk-Token** ist strikt read-only: eigene Middleware, Positivliste der erlaubten
  GET-Endpoints, kein Zugriff auf `/api/me`, keine Schreibpfade. Dazu gehört ein
  **read-only Socket.IO-Handshake**: Der Kiosk lebt von Realtime-Updates (`kiosk.js`
  verbindet sich heute per Socket) – der Token joint deshalb genau den Room seines Events
  (empfangen ja, senden nein). Ohne diesen Pfad wäre die Wand-Anzeige nach dem Wegfall des
  geteilten Tokens nur noch so aktuell wie ihr letzter Poll.
- **Agent unverändert – aber der Key wird zum Geheimnis:** `api_key`-Header wie bisher;
  Agent-Endpoints hängen **nicht** hinter `requireUser` (der Agent hat keine Session). Genau
  deshalb darf der Key nicht mehr allgemein lesbar sein: `GET /api/players/:id` liefert heute
  die volle Zeile **inklusive `api_key`** an jeden Aufrufer – mit echten Logins könnte damit
  jeder User fremde Agent-Reports fälschen. Künftig wird der Key nur noch an den
  Konto-Inhaber selbst (für den personalisierten Agent-Download) und Admins ausgegeben,
  überall sonst gestript; dazu ein Admin-/Selbstbedienungs-Endpoint zum Rotieren des Keys.

### 5.3 Missbrauchs- und Ausfall-Szenarien

- **Brute-Force:** Rate-Limit auf `POST /api/auth/login` pro Konto **und** pro IP (z. B.
  10 Fehlversuche → 60 s Sperre, exponentiell). Wichtig: hinter einem Cloud-Proxy teilen sich
  alle Partygäste ggf. eine IP – die Sperre pro IP darf deshalb nie so scharf sein, dass ein
  Scherzkeks mit absichtlichen Fehl-Logins die ganze Party aussperrt; die Konto-Sperre
  wiederum meldet im UI klar „zu viele Versuche, warte kurz".
- **Session läuft mitten auf der LAN ab:** durch gleitende Verlängerung praktisch
  ausgeschlossen; falls doch (Gerät lag 90 Tage im Schrank), landet man auf dem Login-Screen
  mit vorausgefülltem Namen – ein Feld tippen, weiter.
- **Passwort vergessen:** Admin erzeugt Reset-Link (Invite mit `purpose = 'reset'` und
  `player_id` – bewusst eine eigene Code-Sorte, siehe 4.1). Vergisst der **letzte Admin** sein Passwort: `ADMIN_RECOVERY_CODE` aus der
  Server-Config erlaubt einmalig, ein Konto zum Admin zu machen.
- **Mehrere Geräte pro Person:** ausdrücklich unterstützt (Handy + Laptop = zwei Sessions).
  Der Profil-Screen kann später eine „Angemeldete Geräte"-Liste mit Einzel-Logout bekommen –
  nice-to-have, kein Muss.

---

## 6. Rollen- & Rechte-Management im Detail

### 6.1 Reichen zwei Rollen?

Ja – mit einer bewussten Vorbereitung für später. Das effektive Rechtemodell hat drei
Dimensionen, von denen nur eine eine „Rolle" im klassischen Sinn ist:

1. **Globale Rolle:** `admin` | `user` (Spalte `players.is_admin`).
2. **Event-Mitgliedschaft:** ergibt sich aus `event_participants` – wirkt wie eine implizite
   Rolle („Mitglied von Event X"), ist aber Datenzugehörigkeit, keine Berechtigung, die man
   verwalten muss.
3. **Konto-Art:** echter Mensch vs. `is_test` (Test-User: nie Admin, nie Push, impersonierbar).

Ein feineres Modell (z. B. „Event-Orga", die nur ihr eigenes Event verwalten darf) ist für
15 Freunde Overkill – **aber** wir machen das Schema vorwärtskompatibel:
`event_participants` bekommt `role TEXT NOT NULL DEFAULT 'member'`. Sollte später „jeder darf
Events anlegen und ist Orga seines Events" gewünscht sein (offene Frage 11.5), ist das eine
reine Logik-Erweiterung ohne Migration.

### 6.2 Rechte-Matrix

| Aktion | anonym | User | User (Nicht-Mitglied des Ziel-Events) | Admin |
|---|---|---|---|---|
| Login/Register/Claim | ✅ | – | – | – |
| Stammdaten lesen (Spieler, Spiele, Skills, Bock) | ❌ | ✅ | ✅ | ✅ |
| Eigene Skills/Bock/Profil/Anreise pflegen | ❌ | ✅ | ✅ | ✅ |
| Event-Daten lesen (Votes, Turnier, Sitzplan, Bestellungen, Durchsagen, Live) | ❌ | ✅ (als Mitglied) | ❌ (`404`) | ✅ |
| Mitmachen (voten, Ergebnis melden, bestellen, Ping, Draft-Pick, Sitznachbar) | ❌ | ✅ (im eigenen Kontext, s. 7.2) | schreibt in Sentinel, nie ins fremde Event | ✅ |
| Spiele anlegen/bearbeiten | ❌ | ✅ (bleibt offen – Selbstorganisation) | ✅ | ✅ |
| Event anlegen/bearbeiten/Teilnehmer/Tracking | ❌ | ❌ | ❌ | ✅ |
| Löschen (Spieler, Spiele, Turniere, Runden, Draws, Matches, Durchsagen) | ❌ | ❌ (eigene frische Fehleingaben: s. 6.3) | ❌ | ✅ |
| Invite-/Claim-/Kiosk-Codes erzeugen, Rollen vergeben | ❌ | ❌ | ❌ | ✅ |
| Test-User anlegen, Impersonation | ❌ | ❌ | ❌ | ✅ (nur `is_test`-Ziele) |

### 6.3 Sonderfälle, die man vorab entscheiden muss

- **Letzter Admin:** „Admin entziehen" und „Spieler löschen" sind blockiert, wenn das Ziel
  der letzte Admin ist (`409` mit klarer Meldung). Das schließt Selbst-Degradierung ein.
  Der parallele Fall (zwei Admins entziehen sich gleichzeitig gegenseitig die Rechte) ist ein
  Check-dann-Schreiben-Muster → Guard in einer Transaktion + Concurrency-Test.
- **Rollen wirken sofort:** Rechte werden pro Request aus der DB gelesen (Session speichert
  keine Rolle). Ein frisch entzogener Admin verliert die Rechte also mit dem nächsten Request,
  nicht erst beim nächsten Login. Für offene Socket-Verbindungen reicht das nicht (die stellen
  keine neuen Requests): eine Rollenänderung stößt dasselbe sofortige Re-Rooming an wie eine
  Roster-Änderung (4.4).
- **Eigene Fehleingaben korrigieren:** Heute kann jeder z. B. ein falsch gemeldetes Match
  per PATCH korrigieren. Das bleibt bewusst so (Selbstorganisation); nur das endgültige
  **Löschen** wird Admin-Sache. Damit braucht es keinen „Besitzer"-Begriff pro Datensatz.
- **Namensregeln:** Login-Name = Spielername. Case-insensitive Eindeutigkeit ist **bereits
  umgesetzt** (Unique-Index `name COLLATE NOCASE` in `db.ts`) – der Login übernimmt dieselbe
  Collation. Umbenennen bleibt erlaubt – ein freigewordener Name kann neu vergeben werden;
  das Passwort verhindert Verwechslungs-Logins.
- **Selbstlöschung:** Es gibt keinen „Konto löschen"-Knopf für User – bei 15 Freunden ist das
  ein Admin-Gespräch. Vermeidet die Kaskaden-Fußangel aus 8.4 im Selbstbedienungs-Modus.
- **Invite-Hygiene:** Codes verfallen (Default 14 Tage), sind einzeln zurückziehbar und im
  Admin-Bereich mit Status (offen/benutzt/abgelaufen) gelistet. Ein Invite-Code in einem
  Gruppenchat ist damit ein begrenztes Risiko, kein Dauer-Generalschlüssel wie der heutige
  Token-Link.

---

## 7. Bewertung: das „immer laufende Event" (Sentinel-Modell)

### 7.1 Urteil: ja, beibehalten

Die Frage war, ob „es gibt quasi ein immer laufendes Event für die Zeit außerhalb von Events"
sinnvoll und gut umsetzbar ist. **Ja – es ist sogar schon so gebaut und bewährt sich.** Der
Sentinel `OUTSIDE_EVENTS_ID` existiert, 16 Tabellen hängen mit `NOT NULL event_id` daran, und
dadurch gibt es im ganzen Code keinen „kein Event"-Sonderfall (keine nullable FKs, keine
`IS NULL`-Zweige in Auswertungen). Die Alternative – `event_id NULL` für „außerhalb" – würde
jede Query und jeden Filter-Dropdown mit einem Sonderfall infizieren. Auch die Auswertungen
gehen damit heute schon richtig um: die Hall of Fame krönt z. B. ausdrücklich nur echte Events
(„außerhalb" ist keine LAN, die man gewinnen kann).

Drei Eigenschaften des Sentinels muss das User-Management aber **explizit definieren**, statt
sie implizit zu lassen:

| Eigenschaft | Regel |
|---|---|
| Roster | Der Sentinel hat keine Teilnehmerliste → „Teilnehmer" = alle **aktiven** echten User (ohne Test- und deaktivierte Konten); während ein Event trackt, gehören dessen Teilnehmer zur Event-Welt und zählen nicht zur Sentinel-*Zustell*-Audience (4.4) – *lesen* dürfen Sentinel-Daten weiterhin alle. Zentral im Helfer `getEventAudience()` verankert, den Push, Broadcasts und Realtime-Rooms gemeinsam nutzen |
| Lebenszyklus | Der Sentinel kann nie tracken, nie enden, nie gelöscht/umbenannt werden (teilweise schon so geschützt) und taucht nie in Hall of Fame/PDF-Andenken auf |
| Sichtbarkeit | Sentinel-Daten sind für alle eingeloggten User sichtbar – er ist der gemeinsame Grundraum |

### 7.2 Die eine echte Schwachstelle: Kontext-Zuordnung beim Schreiben

Heute taggen alle Schreibpfade stumpf mit `getTrackingEventId()`. Sobald Events
Sichtbarkeitsgrenzen sind, wird daraus ein Fehler: Trackt gerade „LAN Winter 2027" und ein
User, der **nicht** eingeladen ist, meldet ein Match oder startet eine Bestellung, dann landet
sein Datensatz im fremden Event – das er selbst gar nicht sehen darf. Er würde in ein
unsichtbares Event hineinschreiben, und die Event-Teilnehmer fänden fremde Daten in ihrer
Auswertung.

**Regel (neu, zentral):** Der Schreib-Kontext ist personenbezogen –
`getEventContextFor(playerId)` = trackendes Event, **wenn** der User dort Teilnehmer ist,
sonst Sentinel. Der Agent-Report kennt heute nur die halbe Regel: Nicht-Teilnehmer werden
während eines trackenden Events schlicht **gar nicht** erfasst. Künftig nutzt auch der
Agent-Pfad `getEventContextFor()` und schreibt sie stattdessen in den Sentinel – sonst zeigt
deren „Außerhalb von Events"-Live-Board während einer fremden LAN nur eingefrorene
Offline-Daten (pausierte und deaktivierte Spieler bleiben ausgenommen). Dieselbe Regel gilt
für alle übrigen Schreibpfade (Votes, Matches, Bestellungen, Pings, Sitznachbarn, Anreisen,
Drafts …).

Konsequenz für die Anzeige: Während ein Event trackt, existieren **zwei parallele Welten**
(Event-Welt und Sentinel-Welt). Das UI muss den eigenen Kontext deshalb sichtbar machen –
ein dezentes, permanentes Badge im Header („LAN Winter 2027" bzw. „Außerhalb von Events"),
damit nie unklar ist, wohin die eigene Aktion zählt und warum zwei Leute gerade
unterschiedliche Abstimmungen sehen.

### 7.3 Zuordnungsfehler durch vergessenes Tracking

Zweites reales Risiko des Modells (schon heute, verschärft durch Sichtbarkeit): Der Abend
läuft, aber niemand hat „Tracking starten" gedrückt → die ersten Stunden landen im Sentinel
und fehlen später in der Event-Auswertung und im PDF-Andenken. Maßnahmen, pragmatisch
gestaffelt:

1. **Erinnerung statt Automatik (empfohlen):** Liegt „jetzt" im Zeitfenster eines nicht
   getrackten, nicht beendeten Events, zeigen App und Kiosk Admins einen deutlichen Hinweis
   „Event läuft laut Plan – Tracking starten?". Ein Auto-Start zur `starts_at`-Zeit ist
   verlockend, aber riskant (Testtermine, verschobene Events, überlappende Events) – bewusst
   dagegen entschieden.
2. **Admin-Werkzeug „Daten umziehen" (nice-to-have, Phase 6+):** verschiebt Datensätze eines
   Zeitfensters (Matches, Play-Sessions, Vote-Runden, Bestellungen) vom Sentinel in ein Event.
   Repariert vergessenes Tracking nachträglich, statt es nur zu bedauern.

---

## 8. Edge-Case-Katalog: Anzeige & Auswertungen

Die Sichtbarkeitsgrenze ist bei den *Live-Features* einfach (Room/Filter pro Event). Knifflig
sind die **event-übergreifenden Auswertungen** – hier die konkreten Fälle aus dem Code und die
jeweilige Entscheidung:

### 8.1 Aggregationen über alle Events

- **Leaderboard** (`GET /api/leaderboard`): aggregiert heute alle `matches` **ohne jeden
  Event-Filter**. Hall of Fame listet alle echten Events samt Namen und Champions.
  **Entscheidung (Empfehlung):** Aggregationen bleiben für alle sichtbar – es ist eine
  Freundesgruppe, und „ewige Rangliste" lebt davon, vollständig zu sein. Die Grenze verläuft
  eine Ebene tiefer: **Drill-Downs** (Event-Detailseite, Match-Listen eines fremden Events,
  Vote-Historie) sind mitgliedschafts-gebunden. Das UI verlinkt aus Aggregationen deshalb nur
  in Events, in denen der Betrachter Mitglied ist – sonst gäbe es klickbare Links auf `404`.
  Wichtig: Diese Empfehlung gilt für *einen* Freundeskreis pro Instanz. Für fremde Gruppen
  auf einer gemeinsamen Instanz würde ein bloßes Umschalten der Aggregationen auf „eigene
  Events + Sentinel" ohnehin nicht dichthalten: Spielerprofile, Spiele, Skills und Bock sind
  konzeptionell global sichtbar, `/api/players` & Co. blieben also ein Leak. Echte
  Gruppentrennung hieße Mandanten-Scoping über fast alle Tabellen – die Empfehlung ist
  stattdessen, „ein Freundeskreis pro Instanz" zur harten Annahme zu machen und einer zweiten
  Gruppe eine zweite Instanz zu geben (Entscheidung 11.4, muss **vor** Phase 5 bestätigt
  sein).
- **Analytics/Stats/Matches/Vote-Historie** akzeptieren ein freies `?eventId=`
  (`analytics.ts`, `stats.ts`, `matches.ts`, `votes.ts`): Ab Phase 5 wird jedes übergebene
  `eventId` gegen die Mitgliedschaft validiert (Admin: alles), und der **Default** wechselt
  von „trackendes Event" auf „Kontext des Users" (7.2) – sonst bekäme ein Nicht-Mitglied als
  Default die Daten des fremden trackenden Events.
- **Event-Filter-Dropdowns** im Frontend (Analytics, Matches, Turniere, Hall of Fame) speisen
  sich aus `GET /api/events` und zeigen damit automatisch nur noch eigene Events + Sentinel.

### 8.2 Persönliche Auswertungen

- **Digest** (`GET /api/digest?playerId=`) und „Meine Stats" beantworten heute jede beliebige
  `playerId` – damit ließe sich z. B. fremdes Abstimmungsverhalten ablesen („hat noch nicht
  gevotet"). Ab Phase 2 kommt die Identität ausschließlich aus der Session; der
  Query-Parameter entfällt.
- **Skills/Bock bleiben global lesbar** (bewusst: Matchmaking-Transparenz in der Gruppe),
  aber schreibbar nur fürs eigene Konto – heute schreibt `PUT /api/skills/:playerId/:gameId`
  jede Kombination.

### 8.3 Live-Anzeige & Kiosk

- **Live-Board:** Trackt ein Event, sieht dessen Teilnehmer das Event-Board; Nicht-Mitglieder
  sehen das Sentinel-Board (ihre eigene Welt, Regel 7.2) – nicht einen leeren oder fremden
  Zustand. Der Kontext-Badge (7.2) erklärt den Unterschied.
- **Kiosk** zeigt über seinen Event-Token genau ein Event – inklusive Push-Historie, weshalb
  `push_log` ein `event_id` braucht (sonst zeigt der Kiosk von „LAN Winter" die Durchsagen
  einer parallelen Gruppe).
- **Roster-Änderung mitten im Event:** Wird jemand von der Teilnehmerliste genommen, während
  er spielt, bleibt heute seine offene `play_sessions`-Zeile einfach liegen (nur
  Tracking-Start/-Stopp räumen auf). Neu: Roster-Entfernung beendet offene Sessions des
  Betroffenen und entfernt seinen Live-Status – sonst zeigt das Event-Board dauerhaft einen
  „spielt seit …"-Geist, den der nächste Sweep nie schließt.
- **Socket-Rooms bei Roster-Änderung:** ohne aktives Nach-Joinen/-Verlassen (4.4) bekäme ein
  frisch Eingeladener bis zum Reconnect keine Realtime-Updates bzw. ein Entfernter weiterhin
  alle. Gleiches Prinzip für Push: Empfängerliste wird pro Versand frisch berechnet, nie
  gecacht.

### 8.4 Löschen vs. Historie (Admin-Moderation)

- **Spieler hart löschen verzerrt Auswertungen doppelt:** (a) `ON DELETE CASCADE` entfernt
  seine Votes, Play-Sessions, Skills – Spielzeit-Auswertungen und Awards schrumpfen
  rückwirkend. (b) `matches.result` und Turnier-Strukturen speichern Spieler-IDs als
  JSON-Snapshot, die **nicht** kaskadieren – das Leaderboard behielte Einträge, deren
  Namens-Lookup ins Leere läuft (namenlose Zeilen). **Entscheidung:** Hartes Löschen ist für
  Test-User und Unfälle gedacht; für echte Ex-Mitspieler gibt es stattdessen **Deaktivieren**
  (`deactivated_at`: kein Login, keine Push, nicht in Pickern/Rostern, aber Historie und
  Namens-Lookups bleiben intakt). Deaktivieren muss auch den **Agent-Pfad** abdecken: der auf
  dem Rechner des Ex-Mitspielers installierte Agent läuft ggf. weiter und authentifiziert
  sich am `requireUser`-freien Agent-Endpoint allein per `api_key` – Reports deaktivierter
  Spieler werden deshalb serverseitig ignoriert (wie bei `tracking_paused`) und beim
  Deaktivieren werden offene Play-Sessions geschlossen und der Live-Status entfernt. Ebenso
  den **Session-Pfad**: Wegen der 90-Tage-Sessions bliebe ein bereits eingeloggtes Gerät
  sonst voll handlungsfähig – Deaktivieren löscht daher alle `sessions`-Zeilen **und
  `push_subscriptions`** des Spielers, trennt seine offenen Sockets sofort (wie bei
  Logout/Passwortwechsel, sonst empfängt ein offener Tab weiter Realtime-Updates), und
  `requireUser` lehnt `deactivated_at`-Konten grundsätzlich ab (Prüfung pro Request, wie
  bei Rollen). Der
  Lösch-Dialog sagt ehrlich, was kaskadiert, und bietet Deaktivieren als Default-Alternative
  an.
- **Event löschen:** kaskadiert durch alle 16 event-gebundenen Tabellen – inklusive
  Hall-of-Fame-Eintrag und PDF-Grundlage. Bleibt möglich (Testdaten!), aber der Dialog
  benennt den Umfang („löscht X Matches, Y Turniere, Z Sessions unwiderruflich"); für echte
  vergangene Events ist „Beenden" der richtige Weg, nicht Löschen.
- **Vote-Runden/Draws löschen** ist harmlos (reine Historie ohne abhängige Snapshots) – genau
  dafür sind die neuen Admin-DELETEs gedacht.

### 8.5 Zeit- und Zuordnungs-Grenzfälle

- **Tracking zu spät gestartet:** erste Stunden liegen im Sentinel → Erinnerung + optionales
  Umzugs-Werkzeug (7.3). Analog beim vergessenen Stoppen: Nachspiel-Sessions landen noch im
  Event – Auswertungen zeigen als Zeitraum deshalb immer die echten Session-Zeitfenster, nicht
  die geplanten Event-Daten (`starts_at`/`ends_at` sind Planungs-, keine Abrechnungsgrenzen;
  die bestehende `from`/`to`-Proratierung in den Analytics bleibt dafür das Werkzeug).
- **Ende der Mitgliedschaft ≠ Ende der Sichtbarkeit:** Wer bei einem Event dabei *war*, sieht
  es dauerhaft (Erinnerungen, PDF-Andenken) – Mitgliedschaft verfällt nicht mit `ended_at`.
  Das braucht ein Schema-Detail: Heute *löscht* eine Roster-Änderung die
  `event_participants`-Zeile – als Autorisierungs-Grundlage wäre die Historie damit weg und
  `requireEventAccess` würde einem nachträglich Entfernten trotz Teilnahme `404` liefern.
  Deshalb bekommt `event_participants` ein `removed_at`: **aktive** Mitgliedschaft (Tracking,
  Audience, Mitmachen) = `removed_at IS NULL`; **Lesesichtbarkeit** = Zeile existiert. Hartes
  Entfernen der Zeile bleibt für den Fall „versehentlich hinzugefügt, war nie da".
- **Test-User in Auswertungen:** Test-User tauchen in Leaderboard/Playtime auf, sobald mit
  ihnen getestet wurde – im echten Betrieb stören sie. Regel: Test-User(-Daten) sind in
  Aggregationen ausgeblendet, solange sie `is_test` sind; wer echte Testdaten behalten will,
  löscht sie eben nicht. Zusätzlich schließt `getEventAudience()` sie von Push/Vote-Erinnerung
  aus (heute zählt `voteNotificationPlayerIds()` im Sentinel-Fall schlicht **alle** Spieler).

---

## 9. Umsetzungsplan (Phasen = mergebare PRs)

Reihenfolge ist so gewählt, dass jede Phase für sich lauffähig ist und `AUTH_MODE=legacy`
das Produktivverhalten bis zum Schluss unangetastet lässt.

| Phase | Inhalt | Größe |
|---|---|---|
| **0 – Bugfix Event-Anlage** | `openModal`-Import in `games.js` (in diesem Branch bereits enthalten) | XS ✅ |
| **1 – Auth-Fundament** | Schema (Spalten, `sessions`, `invites`), scrypt-Hashing, `/api/auth/*`, `/api/me`, `requireUser`-Middleware, Session-Cookie inkl. `COOKIE_SECURE`-Flag, Socket.IO-Handshake + Socket-Kick bei Logout, Login-/Register-Screen, Rate-Limit. Alles hinter `AUTH_MODE` | L |
| **2 – Identität fest verdrahten** | `whoami.js` raus, `player_id` überall aus der Session statt aus Query/Body (inkl. Digest, Meine Stats, Skills/Bock-Schreibpfade), Profil-Screen (Passwort ändern, Logout), Push-Subscription-Neubindung bei Logout/Login | M |
| **3 – Rollen & Admin-Härtung** | `requireAdmin` auf Session-Rolle, PIN-Flow entfernen, **Reset der Alt-Admin-Flags** (heute ist jeder Admin – ohne Reset sind alle Gates No-ops) + Bootstrap + Recovery-Code, Letzter-Admin-Guards (+ Concurrency-Test), DELETE-Endpoints gaten & fehlende ergänzen, Spieler-Deaktivierung statt Hard-Delete (inkl. Session-/Socket-/Push-Abo-Invalidierung + Agent-Ignore), `api_key` nur noch für Inhaber/Admin lesbar + Key-Rotation, `admin_log`, Admin-UI aufräumen | M–L |
| **4 – Onboarding & Migration** | Invite-/Claim-Codes mit Ablauf/Widerruf + UI (Links/QR im Admin-Bereich), Claim-Flow für Bestandsspieler, Namens-Kollisions-Check (NOCASE), Umstellung `AUTH_MODE=required`, Alt-Token/PIN entfernen | M |
| **5 – Event-Sichtbarkeit** | `requireEventAccess`, `getEventContextFor`/`getEventAudience` als zentrale Helfer in allen Schreib-/Versandpfaden, Validierung aller `?eventId=`-Filter, Kontext-Badge im Header, Socket.IO-Rooms inkl. Live-Rejoin bei Roster-/Rollen-/Impersonations-Änderung, Roster-Entfernung schließt offene Sessions, historisierte Mitgliedschaft (`event_participants.removed_at` statt Zeilen-Löschung, 8.5), Push-Scoping, Kiosk-Token inkl. Read-only-Socket, Event-CRUD admin-only, Event-Löschen mit Kaskaden-Warnung. **Dazu gehören die Voraussetzungen der Grenze selbst:** `event_id` für `broadcasts` und `push_log`, Vote-/Draft-Guards pro Event **und die Arcade-Live-Fläche** (`GET /api/arcade/lobbies` aggregiert heute alle offenen Lobbys, die Lobby-Listen gehen per globalem `io.emit` raus – Lobbys bekommen denselben Event-Kontext/Room wie alles andere, sonst sehen und joinen Nicht-Mitglieder weiter die Lobbys des Events). Ohne diese Punkte wäre die frisch eingeführte Sichtbarkeit löchrig | L |
| **6 – Scoping-Lücken & Feinschliff** | `event_id` für `info_entries` (inkl. „global"-Fall fürs Info-Board) und `arcade_results` – beide bleiben bis dahin bewusst global (reine Anzeige-Historie, innerhalb eines Freundeskreises kein Leak); Test-User-Ausschluss aus Aggregationen/Push, Impersonation (`acting_as`), Tracking-Erinnerung; optional: „Daten umziehen"-Werkzeug | M |

Phasen 1–2 sind das kritische Fundament; ab Phase 3 sind die Schritte weitgehend unabhängig
voneinander priorisierbar. Impersonation (in 6) kann bei Bedarf in Phase 3 vorgezogen werden,
wenn das Testen ohne „Nicht du?" vorher zu unbequem wird. Entscheidung 11.4 (getrennte
Freundeskreise ja/nein) muss vor Phase 5 stehen.

---

## 10. Bereits getroffene Detail-Entscheidungen (Rev. 2)

Damit die offene Liste kurz bleibt – diese Punkte betrachtet das Konzept als entschieden
(Einspruch natürlich möglich):

1. **Auth-Verfahren:** Name + Passwort + langlebiges HTTP-only-Session-Cookie; Passkeys als
   möglicher späterer Zusatz-Login (5.1).
2. **Sentinel-Modell bleibt** – mit personenbezogener Kontext-Regel `getEventContextFor()`
   und definierter Sentinel-Audience (7.1/7.2).
3. **Impersonation über `sessions.acting_as`** (ein Cookie, kein Parallelzustand), nur auf
   Test-User, effektive Rechte = Test-User (4.5).
4. **Echte Spieler werden deaktiviert statt gelöscht**; Hard-Delete bleibt für Test-User und
   Unfälle (8.4).
5. **Kein Auto-Tracking-Start**, stattdessen Erinnerungs-Hinweis für Admins (7.3).
6. **Aggregationen (Leaderboard/Hall of Fame) bleiben gruppenweit sichtbar**, Drill-Downs
   sind mitgliedschafts-gebunden – gültig unter der Ein-Freundeskreis-Annahme (8.1, verknüpft
   mit 11.4).

## 11. Offene Entscheidungen

1. **Passwort vergessen (normale User):** Vorschlag: Admin generiert einen Reset-Link
   (gleicher Mechanismus wie Claim-Code). Kein E-Mail-Versand nötig – Freundeskreis.
2. **Dürfen User sich selbst umbenennen?** Bisher ja; mit festen Identitäten spricht wenig
   dagegen (Name bleibt UNIQUE, künftig case-insensitiv). Vorschlag: ja, beibehalten.
3. **Rückwirkende Sichtbarkeit für Neu-Eingeladene:** Wer während des Events dazukommt, sieht
   dann auch alles, was vorher im Event passiert ist. Vorschlag: ja (einfach und im
   Freundeskreis erwünscht) – nur explizit festhalten, damit es niemanden überrascht.
4. **Ein Freundeskreis pro Instanz – harte Annahme bestätigen.** Das Konzept setzt überall
   voraus, dass alle User einander sehen dürfen (Spieler, Spiele, Skills und Aggregationen
   sind bewusst global). Eine Mehrgruppen-Instanz wäre mit gefilterten Auswertungen allein
   nicht dicht (8.1) und liefe auf Mandanten-Scoping fast aller Tabellen hinaus – der
   empfohlene Weg für eine zweite Gruppe ist eine zweite Instanz (eine SQLite-Datei, ein
   Prozess). Muss vor Phase 5 bestätigt sein.
5. **Wer darf Events anlegen?** Konzept sagt: nur Admins. Alternative: jeder darf anlegen und
   wird „Orga" seines Events (Basis dafür ist mit `event_participants.role` vorbereitet,
   6.1). Bewusst erst mal weggelassen.
6. **„Daten umziehen"-Werkzeug** (Sentinel → Event bei vergessenem Tracking, 7.3): einplanen
   oder auf Bedarf verschieben?
