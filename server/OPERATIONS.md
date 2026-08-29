# Serverbetrieb

Der Server schreibt seine Ausgaben über `console.*` auf stdout/stderr. Im Docker-Setup werden diese
Ausgaben über den Container-Logger gesammelt. Für einen mehrtägigen Betrieb sollte die Rotation am
jeweiligen Prozessmanager eingerichtet werden.

## Docker

Docker Compose kann die Größe und Anzahl der JSON-Logdateien begrenzen:

```yaml
services:
  app:
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: '5'
```

Alternativ kann ein zentraler Docker-Logging-Treiber verwendet werden. Die Einstellung muss auf dem
Host bzw. in der Compose-Datei vorgenommen werden, nicht im Node-Prozess.

## systemd

Bei einem systemd-Service übernimmt `journald` die Logs. Auf dem Host sollten `SystemMaxUse` und
`SystemMaxFileSize` in `/etc/systemd/journald.conf` sinnvoll gesetzt und danach `systemctl restart
systemd-journald` ausgeführt werden. Mit `journalctl --vacuum-time=14d` oder `--vacuum-size=500M`
kann vorhandener Altbestand bereinigt werden.

## PM2

Bei PM2 sollte `pm2-logrotate` installiert und konfiguriert werden:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 5
```

Die Datenbankrotation ist davon unabhängig: SQLite-Backups bleiben ein eigener Betriebs- und
Sicherheitsprozess.

## Backup und Restore

Respawn schreibt vor jedem Aktivieren des Event-Trackings einen persistenten SQLite-
Snapshot. Der Eventstart erfolgt erst, nachdem `PRAGMA integrity_check` erfolgreich war und die
Datei atomar von einer temporären Datei auf ihren endgültigen Namen verschoben wurde. Scheitert der
Snapshot, antwortet der Start mit `503` und das Tracking bleibt ausgeschaltet. Auch der manuelle
Download im Admin-Bereich erzeugt einen solchen persistenten Restore-Punkt.

Standardmäßig liegen die Dateien im Ordner `backups` neben `DB_FILE`, im Docker-Setup also unter
`/opt/respawn/data/backups/`. `BACKUP_DIR` kann einen anderen Pfad setzen; `BACKUP_RETENTION`
begrenzt die Anzahl, standardmäßig auf 20. Das Verzeichnis muss auf einem persistenten Datenträger
liegen und sollte zusätzlich extern kopiert werden, weil ein Snapshot auf demselben Host keinen
Schutz vor einem Host- oder Datenträgerausfall bietet.

Ein Snapshot lässt sich vor einem Restore ohne Schreibzugriff prüfen:

```bash
cd /opt/respawn
docker compose run --rm --no-deps app npm run backup:verify -- /app/data/backups/<backup-datei>.sqlite
```

Der produktive Restore bleibt bewusst ein Operator-Vorgang. So bleibt die bisherige Datenbank als
Rückfall erhalten:

```bash
cd /opt/respawn
docker compose stop app
cp -- data/lan.db data/lan.db.before-restore.sqlite
cp -- data/backups/<backup-datei>.sqlite data/lan.db
rm -f -- data/lan.db-wal data/lan.db-shm
docker compose up -d --wait app
```

Danach `/api/health` und die LAN-Bereitschaft im Admin-Bereich prüfen und stichprobenartig Event,
Spieler und Historie öffnen. Schlägt die Prüfung fehl, den Container erneut stoppen, die gesicherte
`data/lan.db.before-restore.sqlite` nach `data/lan.db` kopieren, erneut die beiden möglichen
`lan.db-wal`-/`lan.db-shm`-Dateien entfernen und wieder starten. Das Entfernen verhindert, dass ein
zur ersetzten Datenbank gehörender WAL-Stand beim nächsten Start auf den Restore angewendet wird.

Mindestens vor jeder LAN sollte der komplette Ablauf in einer separaten Testinstallation oder mit
einer Kopie des `data`-Verzeichnisses geprobt werden. Ein erfolgreicher `backup:verify`-Lauf allein
beweist die SQLite-Integrität; erst das Öffnen der wiederhergestellten App bestätigt auch den
operativen Restore-Pfad.

## Produktions-Deployment

Der Workflow `.github/workflows/deploy.yml` baut bereits in jedem Pull Request das vollständige
Runtime-Image, veröffentlicht es dort aber nicht. Für jeden relevanten Push auf `main` wird das mit
dem Commit-SHA getaggte Image anschließend veröffentlicht. Reine Markdown- und `docs/`-Änderungen
durchlaufen im Pull Request die vollständige CI, lösen nach dem Merge aber keinen erneuten
Image-Build und keinen Produktionsneustart aus. Vor einem App-Update wird die versionierte
`docker-compose.yml` auf den Server übertragen; Geheimnisse verbleiben ausschließlich in dessen
nicht versionierter `.env`.

Das Runtime-Image besitzt einen Docker-Healthcheck gegen `/api/health`. Dieser reine Status-Endpunkt
ist ohne Session erreichbar. Das Deployment verwendet `docker compose up -d --wait` und gilt deshalb
erst als erfolgreich, wenn der neue Node-Prozess Anfragen beantwortet. Bei Pull-, Start- oder
Healthcheck-Fehlern gibt der Workflow automatisch `docker compose ps app` und die letzten 100
Container-Logzeilen aus. Dabei wird das zuvor gepinnte Image wieder gestartet, sodass ein kaputtes
Image nicht bis zu einem manuellen Eingriff produktiv bleibt. Auch das generierte Rollback-Skript
wartet auf einen gesunden Container. Auf frisch provisionierten Hosts hinterlegt Cloud-Init
zusätzlich `LEGACY_ROLLBACK_ACCESS_TOKEN`; nur das Rollback-Skript übersetzt ihn für Images vor der
Login-Umstellung in `AUTH_MODE=required` und `ACCESS_TOKEN`. Der laufende aktuelle Server ignoriert
diese Kompatibilitätswerte.

Ein Merge allein gilt ausdrücklich nicht als Deployment-Nachweis. Der fünfminütige Codex-
Pipeline-Monitor liest die ungelöste Fehlerfolge abgeschlossener `CI/CD`-Runs seit dem letzten
erfolgreichen `main`-Lauf, ordnet deren Commit dem gemergten Agenten-PR zu und weckt bei einer
Codex-Implementierung die ursprüngliche Task mit
Run-Link und fehlgeschlagenen Jobs. Die Task informiert den Nutzer, prüft bei einem Deploy-Fehler
Rollback und Produktionszustand und bearbeitet sichere Fixes automatisch; ein Code-Fix beginnt
nach dem Merge immer auf einem neuen Branch und PR. Die erfolgreiche Zustellung wird im
Ursprungs-PR mit `agent-pipeline:codex-delivery` quittiert. Der Monitor blättert die abgeschlossenen
`main`-Läufe so weit zurück, bis der letzte erfolgreiche sichtbar ist. Ist innerhalb dieser Grenze
kein Erfolg erreichbar, gilt das Fenster als abgeschnittene Historie und es wird bewusst nichts
zugestellt: Bleibt `main` dauerhaft rot, ist das ein Betriebsfall für den Nutzer und kein Anlass,
alle betroffenen Tasks zu wecken. Für ursprüngliche Claude-Tasks fehlt weiterhin eine belastbare
Session-Wakeup-Schnittstelle; deren GitHub-Run bleibt die operative Outbox und muss bis zu einer
eigenen Connector-Integration über GitHub überwacht werden.

Die Pflichtchecks laufen als parallele Jobs (Server-Checks, Browser-E2E, Agent, Runtime-Image-Build)
statt als eine serielle Kette; der `publish`-Job veröffentlicht das Image nach grünen Checks aus dem
geteilten Buildx-Layer-Cache, erst danach startet der Deploy. Weil einzelne Vorbedingungen wie die
Bestätigung eines Testlauf-Verdachts im Normalfall übersprungen werden, verwenden `publish` und
`deploy` `always()` und prüfen ihre Vorbedingungen ausdrücklich über `needs.<job>.result`. Ohne
`always()` ergänzt GitHub ein implizites `success()`, das auch bei einer nur mittelbar
übersprungenen Abhängigkeit greift und den Deploy stillschweigend überspringt. Playwright-Browser
werden zwischen Läufen gecacht, und überholte Läufe auf Nicht-`main`-Refs werden per Concurrency
abgebrochen.
Der Docker-Build nutzt den GitHub-Actions-Cache. Alle Jobs haben eigene Timeouts; der
Deploy bleibt über die Concurrency-Gruppe `production-deploy` für den einzelnen Produktionsserver
serialisiert. Die veröffentlichte Environment-URL ist `https://lan.dbehnke.dev`. Referenziert eine
Branch-Protection-Regel noch den früheren Sammel-Check „Build and test“, muss sie auf die neuen
Job-Namen umgestellt werden.

Die Chromium-Installation der E2E-Jobs läuft über `scripts/ci-install-chromium.mjs` statt direkt
über `npx playwright install`. Der Helfer bricht einen Versuch nach 180 Sekunden ab und wiederholt
ihn einmal, weil `playwright install-deps` an `apt-get` weiterreicht und ein hängender Ubuntu-Mirror
sonst das gesamte Job-Timeout aufbraucht. Beim Abbruch wird zusätzlich ein zurückgebliebener
`apt-get` per `sudo pkill` beendet: Er läuft über `sudo` als root und außerhalb der Prozessgruppe
des Helfers, hält sonst `/var/lib/apt/lists/lock` und lässt die Wiederholung sofort mit
`Could not get lock` scheitern. Scheitern beide Versuche, ist das Ergebnis modusabhängig: Die reinen
Systempakete (`deps`, nur bei Playwright-Cache-Treffer) gelten als Best Effort und der Job läuft
weiter, weil das Runner-Image sie mitbringt und Playwright eine tatsächlich fehlende Bibliothek beim
Start von Chromium benennt. Das Browser-Bundle (`browser`, nur bei Cache-Fehltreffer) hat keinen
solchen Rückfall und lässt den Schritt fehlschlagen.

Das Zeitlimit ist kein kosmetischer Unterschied: Ein per Job-Timeout beendeter Job endet als
`cancelled`. Wird danach nur der Sammel-Check `Browser E2E` neu gestartet, liest dieser dasselbe
eingefrorene Ergebnis erneut und scheitert binnen Sekunden mit
`A browser E2E partition ended with: cancelled`, während `publish` und `deploy` übersprungen
bleiben; beliebig viele solcher Neustarts ändern daran nichts. Ein so festgefahrener Lauf wird über
„Re-run all jobs“ (API: `POST /actions/runs/<id>/rerun`) gelöst, das jeden Job neu startet. Der
Timeout des Helfers macht aus dem Hänger von vornherein einen gewöhnlichen, wiederholbaren
Fehlschlag.

Der reine, nicht veröffentlichende Image-Gate-Build erzeugt keinen Build-Record und keine
Provenance-Attestation. Der nach allen Pflichtchecks ausgeführte Publish-Build behält die
standardmäßige Provenance des Docker-Builds bei. `better-sqlite3` wird als offizielles
Node-24-Linux-Prebuild installiert; deshalb enthält die Builder-Stage keine native
Compiler-Toolchain. Ein leerer BuildKit-Cache bleibt unterstützt, da `npm ci` weiterhin exakt das
versionierte `package-lock.json` verwendet. Dessen Integritätswert deckt das npm-Paket ab, nicht
jedoch das separat aus dem Upstream-GitHub-Release geladene native Prebuild. Ist dieses Prebuild
nicht verfügbar, schlägt der Image-Build bewusst fehl, statt auf eine lokale Kompilierung
zurückzufallen.

Die Compose-Konfiguration verwendet den lokalen Docker-Logging-Treiber mit Größen- und
Dateilimits, damit App- und Tunnel-Logs den Datenträger nicht unbegrenzt füllen.

Die nicht versionierte Server-`.env` muss einen starken `ADMIN_RECOVERY_CODE` enthalten. Der Server
verweigert in Produktion andernfalls bewusst den Start, damit ein Deployment nicht ohne
erreichbaren ersten/letzten Admin live geht. Beim erstmaligen Einrichten wird über
`/?claim=<RECOVERY_CODE>` ein bestehendes Profil als Admin beansprucht; erst danach werden die
übrigen persönlichen Claim-Links verteilt.
Der Bootstrap-Pfad ist danach geschlossen. Gibt es genau einen aktiven, beanspruchten Admin, kann
`/?reset=<RECOVERY_CODE>` dieses letzte Admin-Konto wiederherstellen; bei mehreren Admins wird der
Recovery-Code für Resets abgelehnt.

Für lokale Starts ohne bestehendes Konto erzeugen `npm run dev` und `npm start` einen temporären
Recovery-Code und geben den vollständigen Claim-Link aus. Der direkte Runtime-Aufruf
`node dist/index.js` beendet sich auf einer leeren Datenbank dagegen bewusst, wenn weder ein
beanspruchtes Admin-Konto noch `ADMIN_RECOVERY_CODE` vorhanden ist.
Die lokalen npm-Wrapper setzen standardmäßig `COOKIE_SECURE=0`, damit persönliche Sessions über
bewusstes LAN-HTTP funktionieren; direkte Starts müssen diesen Wert selbst setzen oder HTTPS nutzen.

Alternativ zum Recovery-Claim können ein oder mehrere Admins beim Start direkt aus der `.env`
angelegt werden (`BOOTSTRAP_ADMIN_<n>_NAME` / `BOOTSTRAP_ADMIN_<n>_PASSWORD`). Das Seeding ist
idempotent und überschreibt kein bereits gesetztes Passwort; Details und Betriebshinweise stehen in
[`../docs/BOOTSTRAP-ADMINS.md`](../docs/BOOTSTRAP-ADMINS.md).

Für jedes LAN-Event legt der Server automatisch ein eigenes Konto `kiosk-<eventId>` an; bestehende
LAN-Events werden beim Upgrade nachgezogen. Die Konten stehen in der Admin-Kioskverwaltung und
verwenden alle `KIOSK_PASSWORD` als gemeinsames Passwort. Ist diese Variable nicht gesetzt, dient
`KIOSK_TOKEN` aus Kompatibilitätsgründen zugleich als gemeinsames Passwort. Sind beide leer,
generiert der Server beim ersten Bedarf selbst ein zufälliges Passwort und speichert es dauerhaft
in der DB (`app_state`, gleiches Muster wie die VAPID-Push-Keys); Admins sehen es in der
Kioskverwaltung, sodass kein manuelles Setup nötig ist. Eine erfolgreiche
Anmeldung auf `/kiosk.html` erzeugt ausschließlich einen zufälligen, exakt auf dieses Event
begrenzten Kiosk-Token: kein Spielerkonto, keine Browser-Session und kein Zugriff auf andere APIs.
Der direkte Aufruf `/kiosk.html?token=<KIOSK_TOKEN>` bleibt für bereits eingerichtete Displays
kompatibel, bleibt aber ohne gesetztes `KIOSK_TOKEN` gesperrt (kein Auto-Fallback für diesen
installationsweiten Direkt-Token).

Eine Instanz bedient genau eine Freundesgruppe (`docs/plans/reset-single-group.md`); es gibt keine
API oder Oberfläche mehr, um weitere Gruppen anzulegen, ihnen beizutreten oder sie zu verlassen. Die
Migration legt die dauerhafte Startgruppe an und ordnet bestehende Konten zu; das ist die einzige
Gruppe, die je existiert. Ein zweiter Freundeskreis erhält ein eigenes Deployment statt einer
zweiten Gruppe in derselben Instanz.

Gruppenrollen und gruppengebundene Events werden bei jedem Request serverseitig neu aufgelöst. Der
vom Browser optional gesendete `x-group-id` wird weiterhin akzeptiert, aber jede Anfrage auf die
Startgruppe aufgelöst; er ist nur die Anzeige des aktuellen Kontexts und niemals ein
Berechtigungsnachweis. Objektzugriffe leiten die besitzende Gruppe aus der Ressource ab. Änderungen
an Mitgliedschaften und Rollen wirken deshalb ohne neue Anmeldung. Gruppenaktionen stehen im
Gruppen-Audit, während `/api/admin/audit` ausschließlich Instanzaktionen enthält.
Der letzte aktive Owner kann weder herabgestuft, entfernt noch als Konto deaktiviert werden. Aus der
Startgruppe können generell keine Mitglieder entfernt werden — anders als in einem Mehrgruppenmodell
gibt es keine andere Gruppe, in die sie wechseln könnten; das Deaktivieren des Kontos (siehe oben)
ist der vorgesehene, reversible Weg, jemandes Teilnahme zu beenden.
Owner-/Rollenaktionen verlangen weiterhin Step-up-Reauth.

Die in Workflows verwendeten Actions werden über `.github/dependabot.yml` wöchentlich auf Updates
geprüft. Runtime-Deprecation-Warnungen in Action-Post-Steps stammen aus der jeweiligen Action und
nicht automatisch aus dem Node-Prozess der Anwendung; sie werden durch zeitnahe Action-Upgrades
behoben.
