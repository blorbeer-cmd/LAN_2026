# Jam mit Spotify

- Voraussetzung: ein [Spotify-Premium-Konto](https://www.spotify.com/premium/) und eine eigene App im
  [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Dort nur die Client-ID
  benötigen; ein Client-Secret wird dank PKCE nicht verwendet.
- In der Spotify-App exakt `http://127.0.0.1:43821/callback` als Redirect URI eintragen. Diese lokale
  Adresse bleibt gleich, unabhängig von der späteren Respawn-Serveradresse.
- Als Gruppen-Owner oder Admin in Respawn unter **Mehr → Jam** auf **Controller herunterladen**
  klicken und das ZIP auf den festen Musik-PC oder Raspberry Pi übertragen und entpacken.
- macOS: `Start-macOS.command` öffnen. Windows: `Start-Windows.cmd` öffnen. Raspberry Pi/Linux:
  `bash start-linux.sh` im entpackten Ordner ausführen. Beim ersten Start wird automatisch eine
  private Laufzeit in diesen Ordner geladen; Repository, Node-Installation und `npm` sind nicht nötig.
- Die lokale Einrichtung öffnet sich automatisch. Respawn-Adresse und Kopplungscode sind bereits
  eingetragen, können bei Bedarf aber geändert werden. Die Tooltips zeigen, wo Client-ID und
  Redirect URI im Spotify-Dashboard zu finden sind.
- In Respawn das gewünschte Spotify-Gerät wählen und den Jam starten. Spotify muss auf diesem Gerät
  geöffnet sein; die Ausgabe kann dadurch über die LAN-Boxen laufen, während Spielsound auf einem
  anderen PC bleibt.
- Alle Teilnehmenden können Songs suchen, hinzufügen, entfernen, sortieren sowie pausieren,
  fortsetzen und überspringen. Der Host beziehungsweise ein Gruppen-Admin beendet den Jam. Der
  Kiosk zeigt den laufenden und nächsten Titel.
- Client-ID sowie Zugriffs- und Refresh-Token liegen nur lokal unter
  `~/.respawn/jam-controller.json` und weder in SQLite noch in GitHub. Der Controller ist kein
  Respawn-Spieler und erscheint deshalb nicht in Statistiken. Wenn Spotify den Zugriff widerruft
  oder der Refresh-Token abläuft, den Controller lokal zurücksetzen und erneut verbinden.
- Ohne erreichbaren Controller bleibt Jam deaktiviert. Für eine andere LAN oder ein Ersatzgerät
  dort ein neues Controller-Paket herunterladen und bei Bedarf eine andere Spotify-Developer-App
  verwenden; die neue Kopplung ersetzt die alte. Nur Gruppen-Owner und Admins dürfen einen
  Controller koppeln oder entkoppeln.

Technischer Hintergrund: [Spotify Authorization Code mit PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
und [Vorgaben für Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
sowie [Refresh-Tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens).
