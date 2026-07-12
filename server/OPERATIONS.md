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
