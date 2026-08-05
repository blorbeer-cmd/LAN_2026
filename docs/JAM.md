# Jam mit Spotify

Jam macht ein einziges Spotify-Premium-Konto zur gemeinsamen Musikwiedergabe für die LAN. Nur der
feste Musik-PC oder Kiosk-Raspberry-Pi wird als Controller eingerichtet. Alle Teilnehmenden bedienen
Jam anschließend im normalen Respawn-Browser und benötigen weder Spotify noch eine lokale
Installation.

## So funktioniert Jam

- Ein Teilnehmer wählt ein erreichbares Spotify-Connect-Gerät aus und startet die Session. Er wird
  zum Host; Host und Gruppen-Admins können die Session beenden.
- Alle aktiven Gruppenmitglieder können pausieren, fortsetzen und überspringen sowie Spotify nach
  Titeln, Interpreten und Playlists durchsuchen. Ein vollbreiter Umschalter trennt Titel- und
  Playlist-Ergebnisse innerhalb desselben Ergebnisblocks.
- Einzelne Titel werden als gemeinsame Songwünsche eingereiht. Außerhalb einer laufenden Playlist
  lassen sie sich entfernen und per Drag-and-drop oder Pfeiltasten sortieren.
- Das Starten einer Playlist muss bestätigt werden. Es ersetzt den aktuell laufenden Titel und alle
  noch offenen Songwünsche durch den vollständigen Spotify-Playlist-Kontext.
- Unter **Als Nächstes** steht, wie viele Playlist-Titel noch folgen. Zusätzliche Songwünsche werden
  separat angezeigt und in Eingangsreihenfolge an Spotifys Live-Warteschlange angehängt.
  Währenddessen sind Sortieren und Entfernen ausgeblendet, weil Spotify seine Live-Warteschlange
  dafür nicht veränderbar bereitstellt.
- Der Kiosk zeigt den laufenden Titel, den Fortschritt und den nächsten zusätzlichen Songwunsch,
  aber keine Bedienung oder Spotify-Zugangsdaten.

## Voraussetzungen

- Ein [Spotify-Premium-Konto](https://www.spotify.com/premium/).
- Eine eigene App im [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Aus
  deren **Basic Information** wird nur die Client-ID benötigt; dank PKCE gibt es kein Client-Secret.
- In dieser Spotify-App muss unter **Redirect URIs** exakt
  `http://127.0.0.1:43821/callback` eingetragen sein. Die lokale Adresse bleibt auch bei einer
  anderen Respawn-Serveradresse gleich.

## Erste Installation

1. Als Gruppen-Owner oder Admin in Respawn **Mehr → Jam** öffnen und
   **Controller erstmals herunterladen** wählen.
2. Das ZIP auf dem festen Musikgerät vollständig entpacken. Danach unter macOS
   `Start-macOS.command`, unter Windows `Start-Windows.cmd` oder auf Raspberry Pi/Linux
   `bash start-linux.sh` starten.
3. Die Startdatei kopiert den Controller dauerhaft nach `~/.respawn/jam-controller-app` und lädt
   beim ersten Mal eine geprüfte private Node.js-Laufzeit dorthin. Das Repository, `npm` und eine
   vorhandene Node.js-Installation werden nicht benötigt; der Downloadordner kann danach gelöscht
   werden.
4. Im automatisch geöffneten lokalen Controller sind Respawn-Adresse und Kopplungscode bereits
   vorausgefüllt. Spotify-Client-ID ergänzen, die angezeigte Redirect URI im Dashboard prüfen und
   einmalig **Einmalig mit Spotify verbinden** wählen.
5. Optional auf `http://127.0.0.1:43821` den Autostart aktivieren. Dann startet der Controller nach
   der Anmeldung am Musikgerät selbstständig. Die Browserseite muss im Betrieb nicht geöffnet
   bleiben.
6. Spotify auf dem gewünschten Ausgabegerät öffnen und dort bei Bedarf kurz Musik starten, damit es
   als Spotify-Connect-Gerät erscheint. Anschließend in Respawn **Gerät auswählen** und die Session
   starten.

## Später starten und wieder verbinden

- Für den normalen nächsten Einsatz genügt die bekannte Startdatei der installierten Version. Das
  ZIP wird weder erneut heruntergeladen noch erneut installiert. Mit aktiviertem Autostart entfällt
  auch dieser Schritt.
- Solange der Controller läuft, wiederholt er fehlgeschlagene Verbindungen zu Respawn und Spotify
  automatisch. Eine kurze Netzwerkunterbrechung erfordert weder einen Skript-Neustart noch einen
  neuen Kopplungscode.
- Fordert Respawn eine neue Kopplung an oder wurde der Controller in Jam entkoppelt, in Respawn
  **Vorhandenen Controller koppeln** beziehungsweise **Wiederverbindung vorbereiten** wählen. Den
  neuen zehn Minuten gültigen Code im lokalen Controller unter **Wieder verbinden** eintragen. Die
  vorhandene Spotify-Anmeldung bleibt erhalten.
- Ist nur die Spotify-Anmeldung abgelaufen oder widerrufen, den lokalen Controller öffnen und
  **Spotify-Anmeldung erneuern** wählen. Controller-Paket und Respawn-Kopplung bleiben dabei
  unverändert.
- Die lokale Seite zeigt beide Verbindungszustände getrennt, kann sofort einen neuen Versuch
  auslösen und bietet unter **Verbindung verwalten** als letzte Option einen vollständigen Reset.
  Einen neuen Download braucht es nur auf einem Ersatzgerät oder wenn die lokale Installation
  tatsächlich fehlt.

## Datenschutz und Berechtigungen

Client-ID sowie Spotify-Zugriffs- und Refresh-Token liegen ausschließlich lokal in
`~/.respawn/jam-controller.json`. Der Respawn-Server speichert davon nichts in SQLite oder GitHub,
sondern nur einen gehashten Controller-Schlüssel und öffentliche Wiedergabedaten. Der Controller ist
kein Respawn-Spieler und erscheint nicht in Spielerlisten oder Statistiken. Nur Gruppen-Owner und
Admins dürfen ihn koppeln oder entkoppeln; die gemeinsame Musiksuche und Wiedergabesteuerung steht
allen aktiven Gruppenmitgliedern offen.

Technischer Hintergrund: [Spotify Authorization Code mit PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
und [Vorgaben für Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
sowie [Refresh-Tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens).
