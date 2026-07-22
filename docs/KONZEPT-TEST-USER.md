# Konzept: Test-User im Admin-Modus (mit vorbefüllten Daten)

Stand: 2026-07-11 · Branch `claude/test-user-admin-setup-4ntv3z`

## Ziel

Im Admin-Modus lassen sich mit einem Klick realistische Test-Spieler anlegen, um Features
(Sitzplan, Matchmaking, Abstimmung, Leaderboard, Turniere) alleine durchspielen zu können –
ohne 15 Handys. Dazu gehört:

1. Test-User sind **vorbefüllt**: Platz im Sitzplan, gepflegte „Sichtbare Monitore",
   zufällige **Skill**- und **Bock**-Werte pro Spiel sowie **Spielzeit** (abgeschlossene
   Play-Sessions) für das aktive Event.
2. Test-User sind **nur im Admin-Modus sichtbar** – normale Geräte sehen sie nirgends
   (Spielerliste, Sitzplan, Leaderboard, Live-Status, …).
3. Der **Admin-Modus ist deutlich erkennbar** (dauerhafter Hinweis, nicht nur im Admin-Tab).
4. Der **Admin-PIN entfällt**. Im Legacy-Modus genügt lokal ein Klick; unter Required-Auth
   entscheidet ausschließlich die serverseitige Admin-Rolle der Session.

## Ist-Zustand (relevant)

- „Test-Spieler anlegen" existiert bereits, aber rein clientseitig: `views/admin.js` ruft in
  einer Schleife `POST /api/players` auf. Die Spieler sind normale Spieler ohne Markierung,
  ohne Seed-Daten, für alle sichtbar.
- Im damaligen Ausgangszustand war der Admin-Modus ein Gerät-lokales Flag (`localStorage`) mit
  optionalem PIN. Required-Auth ersetzt diese Vertrauensannahme durch die Session-Rolle.
- Sitzplan: `seating_layouts.assignments` (JSON `{side, seat, playerId}`), beim Speichern
  leitet `syncAutoSeatNeighbors` aus Kanten-Nachbarschaft automatisch `seat_neighbors`-Zeilen
  (`source='auto'`) ab → genau das ist „Sichtbare Monitore".
- Skills (`skills`), Bock (`preferences`): je 1–10 pro (Spieler, Spiel).
  Spielzeit: `play_sessions` (player, game, event, started_at, ended_at, active_ms).

## Kernentscheidungen

### 1. Markierung: `players.is_test`

Neue Spalte `is_test INTEGER NOT NULL DEFAULT 0` (+ Migration nach bestehendem Muster in
`db.ts`). Test-User sind damit normale Spieler in allen Tabellen (Skills, Sessions, Sitzplan
funktionieren ohne Sonderfälle), nur eben markiert. Löschen räumt per `ON DELETE CASCADE`
alles mit ab.

### 2. Seeding gehört auf den Server (ein Endpoint, eine Transaktion)

Die bisherige Client-Schleife wird durch **`POST /api/admin/test-users`** (Body:
`{ count }`, 1–20) ersetzt. Der Server erledigt in **einer** `better-sqlite3`-Transaktion
pro Aufruf:

- **Spieler anlegen:** Namen aus einem kleinen Pool („Test Alex", „Test Kim", …) mit
  Zufalls-Suffix bei Kollision, Farben aus der Avatar-Palette, `is_test = 1`.
- **Skill & Bock:** für jedes vorhandene Spiel je ein Zufallswert 1–10 in `skills` und
  `preferences`. Leicht korreliert (Bock tendenziell hoch, wo Skill hoch ist) wirkt
  realistischer als reines Rauschen – ein simpler „Skill ± 3, geklemmt auf 1–10" reicht.
- **Sitzplan:** freie Plätze im Layout des Tracking-Events auffüllen (Reihenfolge:
  Seiten mit den meisten freien Plätzen zuerst, damit Nachbarschaften entstehen). Sind
  nicht genug Plätze frei, werden Seiten bis `MAX_SEATS_PER_SIDE` (12) vergrößert; erst
  danach bleiben Überzählige unplatziert. Anschließend wie beim normalen Speichern
  `computeAdjacentPairs` + `syncAutoSeatNeighbors` → **„Sichtbare Monitore" sind
  automatisch gepflegt**, mit derselben Logik wie im echten Editor (kein zweiter Codepfad).
- **Spielzeit:** pro Test-User 2–4 **abgeschlossene** `play_sessions` im Tracking-Event:
  zufällige Spiele (bevorzugt die mit hohem Bock), Startzeiten in den letzten ~12 h,
  Dauer 20–120 min, `active_ms` = 60–95 % der Dauer. Damit füllen sich Spielzeit-Auswertung
  und Awards sofort sinnvoll.

Weil der Handler synchron in einer Transaktion läuft, serialisieren sich zwei gleichzeitige
Klicks von selbst – der zweite Aufruf sieht die schon belegten Plätze/Namen. Ein Test mit
parallelen Requests kommt trotzdem in `api.concurrency.test.ts` (Erwartung: keine doppelten
Sitzplätze, keine Namenskollision, Gesamtzahl stimmt).

Dazu **`DELETE /api/admin/test-users`**: löscht alle `is_test`-Spieler und markierten
Test-LANs (Cascades räumen ihre abhängigen Daten auf) und entfernt Sitzplan-Assignments +
zugehörige Auto-Nachbarn. Ein „Test-Daten aufräumen"-Button im Admin-Panel ruft das auf –
so bleibt nach dem Ausprobieren keine Datenleiche für die echte LAN.

### 3. Sichtbarkeit: zentral im Frontend filtern

Test-User tauchen in vielen Antworten auf (Players, Seating, Leaderboard, Live-Status,
Votes, Socket-Events). Zwei Optionen:

- **(a) Serverseitig filtern** je nach „bin ich Admin"-Header: sauber, aber ohne PIN gibt es
  serverseitig keine echte Admin-Identität, und es müssten ~15 Routen und alle
  Socket-Broadcasts fallweise gefiltert werden – viel Fläche für Lücken und Bugs.
- **(b) Clientseitig filtern:** Der Server liefert `is_test` überall mit, das Frontend
  blendet Test-User an **einer** zentralen Stelle aus, wenn das Gerät nicht im Admin-Modus
  ist.

**Empfehlung: (b).** Das passt zum bestehenden Trust-Modell (Admin-Modus ist heute schon
nur ein localStorage-Flag, „not a security boundary"), hält den Server einfach und ist an
einer Stelle wartbar. Konkret:

- `state.js` bekommt einen zentralen Filter (z. B. `visiblePlayers()` bzw. Filterung direkt
  beim Übernehmen der Server-Daten in den State) plus ein Set der Test-IDs, mit dem
  abgeleitete Listen (Leaderboard-Zeilen, Seating-Gruppen, Live-Status, Vote-Ergebnisse)
  gefiltert werden.
- Wechsel des Admin-Modus rendert neu → Test-User erscheinen/verschwinden sofort.
- Im Admin-Modus sind Test-User überall sichtbar (gewollt – nur so kann man Features mit
  ihnen testen) und tragen ein kleines „Test"-Badge, damit man sie von echten Spielern
  unterscheidet.

Bewusste Konsequenz: Wer den localStorage manipuliert, sieht Test-User. Auf einer privaten
LAN irrelevant; falls später echtes Auth kommt (siehe `KONZEPT-USER-MANAGEMENT.md`), zieht
die Filterung auf den Server um.

### 4. Admin-Modus sichtbar machen

Solange der Admin-Modus aktiv ist:

- schmale, dauerhafte **Leiste am oberen Rand** („Admin-Modus aktiv" + Button „Verlassen"),
  über alle Views hinweg, Farbe über ein bestehendes Warn-/Akzent-Token aus dem
  Design-System (kein neuer Hex-Wert);
- zusätzlich `body.admin-mode`-Klasse als Styling-Hook (z. B. dezente Rahmenfarbe), damit
  auch Screenshots eindeutig sind.

### 5. PIN entfernt

- `views/admin.js`: Unlock-Screen entfällt komplett; der Admin-Tab zeigt direkt einen
  „Admin-Modus aktivieren"-Schalter (ein Klick an/aus).
- Server: `requireAdmin` prüft unter Required-Auth die echte Session-Rolle. `ADMIN_PIN`,
  `x-admin-pin` sowie `GET /api/admin/status` und `POST /api/admin/unlock` sind entfernt.
  Der Legacy-Modus behält bis zum Cutover bewusst seinen lokalen Ein-Klick-Vertrauensmodus.

### 6. Als Testspieler anmelden (Testsitzung)

Unter `AUTH_MODE=required` bindet jede Anfrage an genau eine Session — ein Admin kann sich
also nicht einfach clientseitig als Test-Spieler ausgeben, um Multi-User-Features (Vote,
Mitfahrgelegenheiten, Arcade-Lobbys, Push-Zustellung) allein zu testen. Statt die
Session-Bindung aufzuweichen, bekommt ein zweites Gerät/Browserfenster eine **echte, zweite
Session**:

- Neue Invite-`purpose: 'test_login'` (`invites.ts`) mit eigener, kurzer Default-TTL
  (15 Minuten – deutlich kürzer als `register`/`reset`, weil das Einlösen sofort eine
  Session ohne Passwortabfrage erzeugt).
- **Mint:** `POST /api/auth/invites` mit `purpose: 'test_login'`, weiterhin
  `requireSessionAdmin` + `requireRecentReauthentication`. Die Zielprüfung ist gegenüber
  `register`/`claim`/`reset` umgekehrt: nur ein `is_test`-Spieler ist ein gültiges Ziel.
  Im Admin-Panel löst der Button „Testsitzung öffnen" neben jedem Test-Spieler das bestehende
  Invite-Link/QR-Modal aus (`views/admin.js`) — keine neue UI-Komponente.
- **Redeem:** neuer Endpoint `POST /api/auth/test-session` (`routes/auth.ts`). Prüft
  `is_test` und `deactivated_at` erneut zum Einlöse-Zeitpunkt (nicht nur beim Minten),
  konsumiert den Code atomar über `markInviteUsed` und erzeugt eine normale Session für den
  Test-Spieler. `authGate.js` bekommt dafür einen eigenen Login-Modus `testSession`
  (`?testSession=CODE`), der ohne Formular direkt auf „Anmelden" wartet.
- **Sichtbarkeit der Test-Peers:** Eine eingeloggte Testsitzung hat serverseitig kein
  Admin-Recht (`is_admin` bleibt `0`), muss aber ihre Test-Spieler-Peers sehen, um z. B.
  einer von einem anderen Test-Spieler angelegten Mitfahrgelegenheit beitreten zu können.
  Dafür bekommt `testFilter.js` ein eigenes, rein clientseitiges Flag
  (`respawn_test_identity`, gesetzt/gelöscht über `setTestIdentity()`), das wie das
  bestehende `isAdmin()`-Flag **keine Sicherheitsgrenze** ist — es steuert nur, ob Test-Spieler
  im UI dieses Geräts sichtbar bleiben.

Bewusst **nicht** im Scope: ein serverseitiges „Act as" auf der Session des Admins selbst
(einzige Identität pro Browser-Kontext bliebe bestehen, echtes Push und paralleles Arcade-
Testen wären damit nicht abbildbar).

## Sinnvolle Ergänzungen (im Scope)

- **„Test-Daten aufräumen"**-Button (siehe oben) – ohne ihn müllt jeder Testlauf die DB zu.
- **Live-Status anspielen:** 1–2 der Test-User bekommen beim Seeding eine offene Session +
  `live_status.last_seen = jetzt`, damit die Live-Ansicht „spielt gerade" zeigt. Nach dem
  Offline-Timeout kippen sie natürlich auf offline – für einen kurzen Blick reicht es, und
  es testet genau den echten Mechanismus.
- **Sitznachbarn teils „manuell":** ein kleiner Anteil zusätzlicher `seat_neighbors` mit
  `source='manual'` (z. B. ein Über-Eck-Paar), damit auch der Unterschied auto/manuell in
  der UI Testdaten hat.

Bewusst **nicht** im Scope: Fake-Agent-Reports und serverseitige Sichtbarkeits-Enforcement.
Mehrjährige Hall-of-Fame-Testdaten mit Matches und Turnieren werden separat und reproduzierbar
über die Admin-Ansicht angelegt.

## Umsetzungsplan

**Schritt 1 – DB & Backend (Kern):**
`is_test`-Spalte + Migration; `POST /api/admin/test-users` mit komplettem Seeding in einer
Transaktion (Spieler, Skills, Bock, Sitzplan inkl. `syncAutoSeatNeighbors` – dafür wird die
Platzierungs-/Sync-Logik aus `seating.ts` exportiert statt dupliziert –, Play-Sessions,
Live-Status-Anspielung); `DELETE /api/admin/test-users`; `is_test` in allen
Player-Antworten. Socket-Event `players:changed` etc. wie bei normalem Anlegen.

**Schritt 2 – Frontend Sichtbarkeit:**
zentrale Filterung in `state.js` (+ abgeleitete Views: Sitzplan, Leaderboard, Live,
Abstimmung), „Test"-Badge im Admin-Modus, Admin-Panel auf die neuen Endpoints umgestellt
(Anlegen mit Anzahl, Aufräumen-Button in derselben Zeile; der Zähler „X Test-Spieler vorhanden"
steht platzsparend im Tooltip direkt neben „Test-Spieler").

**Schritt 3 – Admin-UX:**
PIN-Unlock aus `views/admin.js` entfernen (direkter Toggle), dauerhafte Admin-Leiste +
`body.admin-mode` in `app.js`/`style.css` (nur Design-Tokens).

**Schritt 4 – Tests & Doku:**
Integrationstests für beide Endpoints (Seed-Vollständigkeit: Sitzplätze, Nachbarn, Werte
in 1–10, Sessions im Event; Cleanup restlos; `count`-Validierung), Concurrency-Test
(2× parallel anlegen), E2E: Admin-Modus an → Test-User anlegen → im Sitzplan/Leaderboard
sichtbar → Admin-Modus aus → nirgends mehr sichtbar → aufräumen. `README`/`ANFORDERUNGEN`
kurz ergänzen.

Jeder Schritt ist einzeln committbar; nach Schritt 1+2 ist das Feature bereits benutzbar.
