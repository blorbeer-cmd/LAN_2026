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

Das Runtime-Image besitzt einen Docker-Healthcheck gegen `/api/health`. Der Check verwendet den im
Container vorhandenen `ACCESS_TOKEN`, ohne ihn in Logs oder Prozessargumenten außerhalb des
Containers offenzulegen. Das Deployment verwendet `docker compose up -d --wait` und gilt deshalb
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
Die Compose-Konfiguration verwendet den lokalen Docker-Logging-Treiber mit Größen- und
Dateilimits, damit App- und Tunnel-Logs den Datenträger nicht unbegrenzt füllen.

Die in Workflows verwendeten Actions werden über `.github/dependabot.yml` wöchentlich auf Updates
geprüft. Runtime-Deprecation-Warnungen in Action-Post-Steps stammen aus der jeweiligen Action und
nicht automatisch aus dem Node-Prozess der Anwendung; sie werden durch zeitnahe Action-Upgrades
behoben.
