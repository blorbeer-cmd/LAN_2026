# Konzept: Richtiges User-Management (Login, Rollen, Event-Sichtbarkeit)

Stand: Juli 2026 · Status: **Entwurf zur Diskussion**

Dieses Dokument beschreibt, wie aus dem heutigen „Jeder darf alles, Identität ist Ehrensache"-Modell
ein echtes User-Management wird: persönlicher Login, feste Identität, Admin-Rolle mit Moderations-
rechten, Test-User-Impersonation und Events, die nur ihre eingeladenen Teilnehmer sehen. Es ergänzt
und korrigiert die ursprünglichen Ideen an einigen Stellen (siehe Abschnitt 3) und endet mit einem
phasenweisen Umsetzungsplan.

---

## 1. Ist-Zustand (was heute wirklich da ist)

Wichtig fürs Konzept: Vieles ist schon näher am Ziel, als man denkt – aber an drei Stellen fehlt
das Fundament komplett.

### 1.1 Zugang & Identität

| Baustein | Heute | Bewertung |
|---|---|---|
| Zugangsschutz | **Ein** geteilter Access-Token für alle (`x-access-token`, im Einladungslink als `?token=`) | Hält Fremde raus, unterscheidet aber niemanden |
| Identität | `whoami.js`: jedes Gerät merkt sich per `localStorage`, „wer es ist" – frei wählbar, jederzeit per „Nicht du?" wechselbar | Reines Vertrauensmodell; genau das soll wegfallen |
| Admin | Geteilte Admin-PIN (`x-admin-pin`), auf jedem Gerät freischaltbar. Es gibt zwar schon `players.is_admin`, aber serverseitig hängt **fast nichts** daran (nur 2 Routen nutzen `requireAdmin`, und der prüft die PIN, nicht die Rolle) | Rolle existiert als Spalte, wird aber nicht durchgesetzt |
| Agent | Pro Spieler ein eigener `api_key` (steckt im personalisierten ZIP) | Bleibt unverändert – das ist bereits „echte" Geräte-Auth |
| Socket.IO | Prüft nur den geteilten Access-Token | Muss künftig die User-Session prüfen |

### 1.2 Event-Scoping der Daten

Die Datenbank ist bereits weitgehend event-fähig: **16 Tabellen** tragen ein `event_id`
(Votes, Vote-Runden, Matches, Auslosungen, Turniere, Play-Sessions, Sitznachbarn, Sitzplan,
Pings, Drafts, Sammelbestellungen, Anreisen, Fahrgemeinschaften …). Der Sentinel
`OUTSIDE_EVENTS_ID` („Außerhalb von Events") fängt alles auf, was ohne getracktes Event passiert.

**Aber:** Das Scoping ist heute nur eine *Ablage-Dimension*, keine *Sichtbarkeits-Grenze* –
jeder sieht alle Events und alle Daten. Und ein paar Tabellen sind noch gar nicht event-bezogen:

- `broadcasts` (Durchsagen) – gehen an **alle** Geräte/Push-Abos
- `info_entries` (Info-Board: WLAN, Links …) – global
- `push_log`, `arcade_results` – global
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
   pro Gerät praktisch einmal ein und ist die ganze LAN (und die nächste) drin.
3. **„Nicht mehr wechseln" heißt nicht „kein Logout".** Logout muss bleiben (geteilte Geräte,
   Familien-Tablet als Kiosk …). Was wegfällt, ist der *passwortlose* Wechsel auf eine fremde
   Identität.
4. **Impersonation nur auf Test-User beschränken.** Wenn Admins sich in *jeden* User verwandeln
   könnten, könnte ein Admin unbemerkt als echter Freund abstimmen/bestellen/schreiben – das
   vergiftet das Vertrauen in alles, was das Tool anzeigt. Deshalb: neue Spalte
   `players.is_test`; „Als dieser User agieren" geht **nur** bei `is_test = 1`. Während der
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
ALTER TABLE players ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN last_login_at INTEGER;

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,          -- nanoid
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,      -- SHA-256 des Session-Tokens (Token selbst nie speichern)
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  impersonated_by TEXT REFERENCES players(id)  -- gesetzt bei Test-User-Impersonation
);

CREATE TABLE invites (
  code        TEXT PRIMARY KEY,          -- nanoid, Einmal-Code
  player_id   TEXT REFERENCES players(id) ON DELETE CASCADE, -- gesetzt = Claim-Code für Bestandsspieler
  event_id    TEXT REFERENCES events(id) ON DELETE CASCADE,  -- optional: direkt in dieses Event
  created_by  TEXT NOT NULL REFERENCES players(id),
  created_at  INTEGER NOT NULL,
  used_at     INTEGER,
  used_by     TEXT REFERENCES players(id)
);
```

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
- Login-Endpoint mit einfachem Rate-Limit (z. B. 10 Versuche/Minute/IP) gegen Durchprobieren.

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
  Session genommen und **nicht mehr aus dem Request-Body akzeptiert** – das ist die eigentliche
  Sicherheits-Umstellung: Heute schicken viele POST-Bodies eine frei wählbare `playerId` mit.
- Profil-Screen behält Name/Avatar/Farbe-Bearbeitung (nur fürs eigene Konto) und bekommt
  „Passwort ändern" + „Abmelden".

### 4.3 Rollen & Durchsetzung

- `requireAdmin` prüft künftig die **Session-Rolle** (`players.is_admin` des eingeloggten
  Users) statt der PIN. Die PIN und der ganze Unlock-Flow im Admin-View entfallen.
- **Bootstrap:** Beim allerersten Start ohne Admin (Migration: kein Spieler mit
  `password_hash` und `is_admin`) wird das erste erfolgreich registrierte/beanspruchte Konto
  automatisch Admin. Zusätzlich Env-Fallback `ADMIN_RECOVERY_CODE` für den Fall „einziger
  Admin hat sein Passwort vergessen".
- Admin-gated werden: alle DELETE-Endpoints, Event-CRUD inkl. Teilnehmerliste und Tracking,
  Spiele-Löschung, Admin-Rechte vergeben/entziehen, Invite-Codes erzeugen, Impersonation,
  Broadcast-Löschung. **Nicht** admin-gated bleibt alles Mitmach-artige (Votes, Skills, Bock,
  Bestellpositionen, eigene Anreise, Ergebnisse melden …) – die LAN soll sich weiter selbst
  organisieren.

### 4.4 Event-Sichtbarkeit

**Grundregel:**

| Datenart | Sichtbar für |
|---|---|
| Stammdaten: Spieler(-Profile), Spiele, Skills, Bock | alle eingeloggten User (bewusst global – „gleiche Truppe jedes Jahr") |
| „Außerhalb von Events" (`OUTSIDE_EVENTS_ID`) | alle eingeloggten User |
| Event-Daten (Votes, Turniere, Sitzplan, Bestellungen, Durchsagen, …) | Teilnehmer des Events + Admins |
| Event-Liste | Admins: alle · User: nur eigene Events (+ Sentinel) |

**Umsetzung serverseitig (zentral, nicht pro Route improvisiert):**
- Ein Middleware-Paar in `auth.ts`: `requireUser` (Session → `req.player`) und
  `requireEventAccess` (löst die `event_id` des Requests auf – aus Query, Body oder der
  referenzierten Ressource – und prüft Mitgliedschaft/Admin; sonst `404`, nicht `403`,
  damit die Existenz fremder Events nicht durchsickert).
- List-Endpoints mit Event-Filter (`/api/events`, Historien, Leaderboard-Zeiträume,
  Hall of Fame, Analytics) filtern auf die Events des Users.
- **Socket.IO-Rooms:** Beim Connect joint der Socket `global` + `event:<id>` für jede eigene
  Mitgliedschaft. `broadcast()` bekommt einen optionalen Event-Scope; alle event-bezogenen
  Realtime-Events (Votes, Turnier, Draft, Sitzplan, Durchsagen, Bestellungen …) senden nur
  noch in ihren Room. Admin-Sockets joinen zusätzlich alle Rooms.
- **Push:** `notifyPlayers()` bekommt den Event-Kontext und schneidet die Empfängerliste auf
  Teilnehmer (heute: alle Abos). Test-User werden nie angeschrieben.
- **Kiosk:** `GET /kiosk.html?k=<kioskToken>` – pro Event generierbarer Read-only-Token
  (eigene kleine Tabelle oder Spalte an `events`), der nur die Kiosk-Aggregat-Endpoints darf.

**Restliche Scoping-Lücken schließen:** `broadcasts` und `info_entries` bekommen ein
`event_id` (Info-Board: pro Event **plus** globale Einträge, denn „WLAN-Passwort" ist
ortsgebunden, „Discord-Link" eher global – gelöst über `event_id NULL` = global sichtbar).
`arcade_results` bekommt `event_id` für saubere Event-Auswertungen. Die Guards „eine laufende
Abstimmung"/„ein aktiver Draft" wandern von global auf pro Event (Key im `app_state` bzw.
Draft-Query um `event_id` erweitern) – inklusive neuer Concurrency-Tests.

### 4.5 Admin-Moderation

- **Löschen:** Bestehende DELETE-Endpoints (Spieler, Spiele, Matches, Turniere, Info-Einträge,
  Quiz-Fragen) hinter `requireAdmin`; neu dazu kommen `DELETE` für Vote-Runden,
  Auslosungs-Historie (`matchmaking_draws`), einzelne Play-Sessions und Durchsagen.
  Alles mit Bestätigungsdialog im UI. Spieler-Löschung kaskadiert weit (`ON DELETE CASCADE`
  durch praktisch alle Tabellen) – der Dialog muss das ehrlich ankündigen („löscht auch alle
  Votes, Sessions, Ergebnisse dieses Spielers").
- **Audit-Log (klein, aber wertvoll):** eine simple `admin_log`-Tabelle
  (wer, was, wann, Ziel-ID) für Löschungen, Rollenänderungen und Impersonations-Starts.
  Kein UI-Aufwand nötig – zunächst reicht, dass es nachvollziehbar in der DB steht.
- **Test-User:** Bulk-Anlage gibt es schon; sie setzt künftig `is_test = 1`. Test-User sind
  in normalen Listen markiert (Badge) und von Push/Digest ausgeschlossen.
- **Impersonation:** `POST /api/admin/impersonate/:playerId` (nur `is_test`-Ziele) erstellt
  eine zweite Session mit `impersonated_by = <admin>`; `POST /api/admin/impersonate/stop`
  kehrt zurück. `GET /api/me` liefert beides, das UI zeigt den permanenten Banner. So kann
  ein Admin z. B. Voting oder Event-Sichtbarkeit aus User-Sicht testen, ohne sich auszuloggen.

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
  Ressourcentyp), Impersonations-Regeln (nur Test-User, Banner-Daten in `/api/me`).
- **Concurrency (`api.concurrency.test.ts`):** doppelte Registrierung desselben Namens,
  doppeltes Einlösen eines Invite-Codes, paralleles Claim, parallele Vote-Runden-Starts in
  **zwei verschiedenen** Events (müssen beide klappen) vs. im selben Event (einer gewinnt).
- **E2E (Playwright):** Login-Gate, Invite-Link-Onboarding, „User sieht fremdes Event nicht",
  Admin löscht Turnier, Impersonation mit Banner und Rückkehr.

---

## 5. Umsetzungsplan (Phasen = mergebare PRs)

Reihenfolge ist so gewählt, dass jede Phase für sich lauffähig ist und `AUTH_MODE=legacy`
das Produktivverhalten bis zum Schluss unangetastet lässt.

| Phase | Inhalt | Größe |
|---|---|---|
| **0 – Bugfix Event-Anlage** | `openModal`-Import in `games.js` (in diesem Branch bereits enthalten) | XS ✅ |
| **1 – Auth-Fundament** | Schema (Spalten, `sessions`, `invites`), scrypt-Hashing, `/api/auth/*`, `/api/me`, `requireUser`-Middleware, Session-Cookie, Socket.IO-Handshake, Login-/Register-Screen, Rate-Limit. Alles hinter `AUTH_MODE` | L |
| **2 – Identität fest verdrahten** | `whoami.js` raus, `player_id` überall aus der Session statt aus dem Body, Profil-Screen (Passwort ändern, Logout) | M |
| **3 – Rollen & Admin-Härtung** | `requireAdmin` auf Session-Rolle, PIN-Flow entfernen, Bootstrap + Recovery-Code, DELETE-Endpoints gaten & fehlende ergänzen, `admin_log`, Admin-UI aufräumen | M |
| **4 – Onboarding & Migration** | Invite-/Claim-Codes + UI (Links/QR im Admin-Bereich), Claim-Flow für Bestandsspieler, Umstellung `AUTH_MODE=required`, Alt-Token/PIN entfernen | M |
| **5 – Event-Sichtbarkeit** | `requireEventAccess`, Filterung aller Event-Listen/-Ressourcen, Socket.IO-Rooms, Push-Scoping, Kiosk-Token, Event-CRUD admin-only | L |
| **6 – Scoping-Lücken & Feinschliff** | `event_id` für `broadcasts`/`info_entries`/`arcade_results` (inkl. „global"-Fall fürs Info-Board), Vote-/Draft-Guards pro Event, Test-User-Badges & Push-Ausschluss, Impersonation | M |

Phasen 1–2 sind das kritische Fundament; ab Phase 3 sind die Schritte weitgehend unabhängig
voneinander priorisierbar. Impersonation (in 6) kann bei Bedarf in Phase 3 vorgezogen werden,
wenn das Testen ohne „Nicht du?" vorher zu unbequem wird.

---

## 6. Offene Entscheidungen

1. **Passwort vergessen (normale User):** Vorschlag: Admin generiert einen Reset-Link
   (gleicher Mechanismus wie Claim-Code). Kein E-Mail-Versand nötig – Freundeskreis.
2. **Dürfen User sich selbst umbenennen?** Bisher ja; mit festen Identitäten spricht wenig
   dagegen (Name bleibt UNIQUE). Vorschlag: ja, beibehalten.
3. **Sichtbarkeit vergangener Events:** Sieht man Events, an denen man teilgenommen hat, nach
   deren Ende weiter (Erinnerungen, PDF-Andenken)? Vorschlag: ja – Mitgliedschaft verfällt nicht.
4. **Hall of Fame / Leaderboard über alle Events:** enthält zwangsläufig Daten aus Events, in
   denen nicht jeder Betrachter Mitglied war. Vorschlag: aggregierte Auswertungen bleiben für
   alle sichtbar (es sind die eigenen Freunde), nur die Event-*Detailansichten* sind begrenzt.
   Wenn strengere Trennung gewünscht ist (z. B. getrennte Freundeskreise), müsste das hier
   ebenfalls gefiltert werden – dann bitte vor Phase 5 entscheiden.
5. **Wer darf Events anlegen?** Konzept sagt: nur Admins. Alternative: jeder darf anlegen und
   wird „Besitzer" seines Events mit Admin-Rechten *nur dort* (Event-Rollen). Das wäre die
   sauberste Lösung für getrennte Freundeskreise, kostet aber ein zusätzliches Rollenmodell –
   bewusst erst mal weggelassen.
