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

## Produktions-Deployment

Der Workflow `.github/workflows/deploy.yml` baut bereits in jedem Pull Request das vollständige
Runtime-Image, veröffentlicht es dort aber nicht. Für jeden relevanten Push auf `main` wird das mit
dem Commit-SHA getaggte Image anschließend veröffentlicht. Reine Markdown- und `docs/`-Änderungen
durchlaufen im Pull Request die vollständige CI, lösen nach dem Merge aber keinen erneuten
Image-Build und keinen Produktionsneustart aus. Vor einem App-Update wird die versionierte
`docker-compose.yml` auf den Server übertragen; Geheimnisse verbleiben ausschließlich in dessen
nicht versionierter `.env`.

Das Runtime-Image besitzt einen Docker-Healthcheck gegen `/api/health`. Im Required-Auth-Modus ist
dieser reine Status-Endpunkt ohne Session erreichbar; ältere Legacy-Images verwenden dafür weiter
den im Container vorhandenen `ACCESS_TOKEN`. Das Deployment verwendet `docker compose up -d --wait` und gilt deshalb
erst als erfolgreich, wenn der neue Node-Prozess Anfragen beantwortet. Bei Pull-, Start- oder
Healthcheck-Fehlern gibt der Workflow automatisch `docker compose ps app` und die letzten 100
Container-Logzeilen aus. Dabei wird das zuvor gepinnte Image wieder gestartet, sodass ein kaputtes
Image nicht bis zu einem manuellen Eingriff produktiv bleibt. Auch das generierte Rollback-Skript
wartet auf einen gesunden Container.

Die Pflichtchecks laufen als parallele Jobs (Server-Checks, Browser-E2E, Agent, Runtime-Image-Build)
statt als eine serielle Kette; der `publish`-Job veröffentlicht das Image nach grünen Checks aus dem
geteilten Buildx-Layer-Cache, erst danach startet der Deploy. Playwright-Browser werden zwischen
Läufen gecacht, und überholte Läufe auf Nicht-`main`-Refs werden per Concurrency abgebrochen.
Der Docker-Build nutzt den GitHub-Actions-Cache. Alle Jobs haben eigene Timeouts; der
Deploy bleibt über die Concurrency-Gruppe `production-deploy` für den einzelnen Produktionsserver
serialisiert. Die veröffentlichte Environment-URL ist `https://lan.dbehnke.dev`. Referenziert eine
Branch-Protection-Regel noch den früheren Sammel-Check „Build and test“, muss sie auf die neuen
Job-Namen umgestellt werden.

Der reine, nicht veröffentlichende Image-Gate-Build erzeugt keinen Build-Record und keine
Provenance-Attestation. Der nach allen Pflichtchecks ausgeführte Publish-Build behält die
standardmäßige Provenance des Docker-Builds bei. `better-sqlite3` wird als offizielles
Node-24-Linux-Prebuild installiert; deshalb enthält die Builder-Stage keine native
Compiler-Toolchain. Ein leerer BuildKit-Cache bleibt unterstützt, da `npm ci` weiterhin exakt das
versionierte `package-lock.json` verwendet.

Die Compose-Konfiguration verwendet den lokalen Docker-Logging-Treiber mit Größen- und
Dateilimits, damit App- und Tunnel-Logs den Datenträger nicht unbegrenzt füllen.

Für `AUTH_MODE=required` muss die nicht versionierte Server-`.env` einen starken
`ADMIN_RECOVERY_CODE` enthalten. Der Server verweigert in Produktion andernfalls bewusst den
Start, damit ein Deployment nicht ohne erreichbaren ersten/letzten Admin live geht. Beim Cutover
wird zuerst über `/?claim=<RECOVERY_CODE>` ein bestehendes Profil als Admin beansprucht; erst danach
werden die übrigen persönlichen Claim-Links verteilt. `ACCESS_TOKEN` bleibt ausschließlich für
Rollbacks auf Legacy-Images in der `.env` und wird vom aktuellen Required-Modus ignoriert.
Der Bootstrap-Pfad ist danach geschlossen. Gibt es genau einen aktiven, beanspruchten Admin, kann
`/?reset=<RECOVERY_CODE>` dieses letzte Admin-Konto wiederherstellen; bei mehreren Admins wird der
Recovery-Code für Resets abgelehnt.

Der gemeinsam genutzte Bildschirm erhält im Required-Modus einen separaten `KIOSK_TOKEN` und wird
einmalig über `/kiosk.html?token=<KIOSK_TOKEN>` eingerichtet. Dieser Zugang ist serverseitig auf die
vom Dashboard benötigten GET-Endpunkte und das Socket-Ereignis `kiosk:subscribe` begrenzt. Ohne
`KIOSK_TOKEN` bleibt der Kiosk im Required-Modus gesperrt. Die spätere eventbezogene Token-Ausgabe
aus dem User-Management-Konzept ersetzt diesen vorläufigen installationsweiten Token.

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
