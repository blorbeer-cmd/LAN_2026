# Agent-Richtlinien

Diese Regeln gelten für Änderungen unter `agent/` zusätzlich zu den gemeinsamen Richtlinien im
Repository-Root. Für Funktionsweise, Einrichtung und Paketierung bei Bedarf `README.md` lesen.

## Architektur und Sicherheit

- Der Agent bleibt ein eigenständiger, als Windows-EXE paketierbarer Node-Prozess.
- Er kennt nur Server-URL, API-Key und die vom Server gelieferte Prozesszuordnung. Die zentrale
  Zuordnung Prozessname → Spiel bleibt auf dem Server.
- Das lokale Kontroll-Tool bindet ausschließlich an Loopback. Der bevorzugte Port ist
  `127.0.0.1:47813`; bei Belegung dürfen die bestehenden Loopback-Fallback-Ports genutzt werden,
  aber niemals eine LAN-erreichbare Adresse.
- Aktivitäts-Tracking bleibt optional, transparent und standardmäßig aus. Bestehende Opt-in- und
  Datenschutzgrenzen nicht aufweichen.
- Verbindungsabbrüche und Server-Neustarts sind erwartbar. Der Agent muss weiterlaufen und spätere
  Meldungen sicher wieder aufnehmen.
- Keine personalisierten `agent.config.json`, API-Keys, Logs oder gebauten Nutzerpakete committen.

## Tests und Verträge

- Aus `agent/` mindestens `npm run lint` und `npm test` ausführen.
- Bei Änderungen am Serververtrag zusätzlich die zugehörigen Server-Vertragstests ausführen.
- Änderungen am echten End-to-End-Ablauf mit `npm run test:e2e` prüfen.
- Tests nutzen isolierte Konfigurationen und Ports und dürfen keine installierte Nutzerinstanz
  verändern.
- Änderungen an Paketierung, Installation, Tray-Steuerung oder lokaler Weboberfläche gemeinsam mit
  `README.md` dokumentieren.
