# Erste Admins per `.env` hinterlegen (Bootstrap-Admins)

Damit du nicht den Recovery-Code-Weg gehen musst, kann der Server beim Start ein oder mehrere
**fertige Admin-Konten** anlegen. Namen und Startpasswörter kommen dabei ausschließlich aus
Umgebungsvariablen (der Server-`.env`) – **niemals aus dem Code oder dem Repository**.

Das ist v. a. für `AUTH_MODE=required` gedacht (persönliche Logins). Ohne gesetzte Variablen passiert
nichts – die Funktion ist dann ein reiner No-Op.

## Was eintragen

Pro Admin ein nummerierter Block (Slot `1`, `2`, …, bis maximal `20`):

```
BOOTSTRAP_ADMIN_1_NAME=Alice
BOOTSTRAP_ADMIN_1_PASSWORD=dein-startpasswort
BOOTSTRAP_ADMIN_2_NAME=Bob
BOOTSTRAP_ADMIN_2_PASSWORD=ein-anderes-startpasswort
```

- **`_NAME`** ist der Login-Name (1–60 Zeichen, muss eindeutig sein). Existiert bereits ein Profil
  mit genau diesem Namen (unabhängig von Groß-/Kleinschreibung), wird es beansprucht statt neu
  angelegt.
- **`_PASSWORD`** ist das Startpasswort. Es gilt die aktuelle Passwortregel: **mindestens 1 Zeichen**
  (keine Mindestlänge, keine Komplexitätsvorgabe), höchstens 200 Zeichen. Wähl trotzdem etwas
  Vernünftiges.
- Getrennte, nummerierte Variablen (statt einer kombinierten Zeile), damit Passwörter beliebige
  Sonderzeichen enthalten dürfen, ohne ein Trennzeichen zu zerschießen.

## Wo eintragen

Die `.env` wird **beim Start** gelesen. Also: Werte eintragen → Server/Container neu starten → der
Bootstrap läuft einmal beim Hochfahren.

### A) Docker auf dem Hetzner-Server

1. `ssh deploy@<HETZNER_HOST>`
2. `sudo nano /opt/respawn/.env` – die Zeilen ans Ende hängen (dort stehen schon `AUTH_MODE`,
   `ADMIN_RECOVERY_CODE`, `KIOSK_TOKEN` …).
3. Neu starten, damit die Variablen greifen:
   ```bash
   cd /opt/respawn && docker compose up -d --wait app
   ```
4. Danach kannst du dich direkt mit Name + Startpasswort anmelden.

### B) Lokal / manuell (Node ohne Docker)

Entweder in deiner `.env`/Startumgebung setzen oder direkt beim Start mitgeben:

```bash
AUTH_MODE=required ADMIN_RECOVERY_CODE=... KIOSK_TOKEN=... \
BOOTSTRAP_ADMIN_1_NAME=Alice BOOTSTRAP_ADMIN_1_PASSWORD=... \
BOOTSTRAP_ADMIN_2_NAME=Bob   BOOTSTRAP_ADMIN_2_PASSWORD=... \
node dist/index.js
```

## Verhalten im Detail

- **Idempotent und nicht-überschreibend:** Hat ein Konto bereits ein Passwort, wird es komplett in
  Ruhe gelassen. Du kannst die Zeilen also stehen lassen – ein Neustart überschreibt nichts, und ein
  später selbst geändertes Passwort bleibt erhalten.
- **Nur unbeanspruchte oder neue Profile** werden gesetzt: entweder wird ein passwortloses
  Bestandsprofil beansprucht oder ein neues Profil angelegt. In beiden Fällen wird `is_admin` gesetzt
  und die Mitgliedschaft in der Instanzgruppe sichergestellt.
- **Erster wird Owner:** Gibt es in der Gruppe noch keinen Owner, wird das erste so beanspruchte
  Konto Owner (wie beim regulären Erst-Claim); weitere werden Admins.
- **Übersprungen wird** (mit Log-Warnung, ohne den Start zu blockieren): leeres/zu langes Passwort,
  fehlender/zu langer Name, ein bereits als **Test-Spieler** markiertes Profil und ein deaktiviertes
  Konto.
- **Recovery-Bootstrap schließt sich:** Sobald ein Admin ein Passwort hat, ist der
  `ADMIN_RECOVERY_CODE`-Bootstrap-Pfad ohnehin zu – du brauchst ihn dann nicht mehr.
- Es werden **keine Passwörter geloggt**, nur Name und Ergebnis (angelegt/beansprucht/übersprungen).

## Danach

- Sag den beiden, dass sie ihr Startpasswort nach dem ersten Login im Profil unter „Passwort ändern"
  wechseln. Ein Zwang dazu ist bewusst (noch) nicht eingebaut.
- Sauberer Abschluss: Sobald beide ihr Passwort geändert haben, die `..._PASSWORD`-Zeilen aus der
  `.env` **entfernen**, damit keine Klartext-Startpasswörter dauerhaft auf dem Server liegen.
  Funktional nötig ist das nicht (die Idempotenz überschreibt nichts), es reduziert nur die
  Angriffsfläche.
