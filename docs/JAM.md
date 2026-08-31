# Jam mit Spotify

Jam macht ein einziges Spotify-Premium-Konto zur gemeinsamen Musikwiedergabe für die LAN. Nur der
feste Musik-PC oder Kiosk-Raspberry-Pi wird als Controller eingerichtet. Alle Teilnehmenden bedienen
Jam anschließend im normalen Respawn-Browser und benötigen weder Spotify noch eine lokale
Installation.

## So funktioniert Jam

- Ein Teilnehmer wählt ein erreichbares Spotify-Connect-Gerät aus und startet die Session. Auf dem
  Musik-PC oder Kiosk kann stattdessen **Diesen Browser als Musikgerät starten** gewählt werden:
  Dann läuft der Ton direkt über dessen HDMI-, TV- oder Soundkarten-Ausgang. Der Teilnehmer wird
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
- Der Kiosk bietet vor dem Sessionstart einmalig **Kiosk-Ton aktivieren** an, wenn der lokale
  Controller auf demselben Gerät läuft. Danach erscheint der Kiosk-Browser als Spotify-Gerät. In
  der laufenden Session zeigt er Titel, Fortschritt und nächsten Songwunsch, aber keine gemeinsame
  Bedienung oder Spotify-Zugangsdaten.
- Wird der Browser oder Kiosk während einer laufenden Browser-Session neu geladen, erscheint
  **Browser-Ton wiederherstellen** beziehungsweise **Kiosk-Ton wiederherstellen**. Die bestehende
  Jam-Session und ihre Warteschlange bleiben dabei erhalten; Respawn akzeptiert nur das neu
  registrierte Spotify-Gerät mit demselben bisherigen Gerätenamen. Der Kiosk-Token darf nur diesen
  eng begrenzten Wiederherstellungsaufruf zusätzlich zu seinen Lesezugriffen ausführen; Start,
  Wiedergabesteuerung und alle anderen Änderungen bleiben gesperrt.

## Voraussetzungen

- Ein [Spotify-Premium-Konto](https://www.spotify.com/premium/).
- Eine eigene App im [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Aus
  deren **Basic Information** wird nur die Client-ID benötigt; dank PKCE gibt es kein Client-Secret.
  Für die lokale Browser-/Kiosk-Ausgabe muss bei der App **Web Playback SDK** aktiviert sein.
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
6. Für Ton über den Musik-PC, dessen HDMI-Fernseher oder eine daran angeschlossene Soundbar Respawn
   direkt auf diesem Computer öffnen, unter **Gerät auswählen** den Browser starten und die Session
   beginnen. Auf `/kiosk.html` zuerst **Kiosk-Ton aktivieren** wählen und die anschließend sichtbare
   Geräteoption von einem angemeldeten Respawn-Tab oder Handy aus starten. Alternativ Spotify auf
   einem eigenständigen Connect-Gerät öffnen und dieses auswählen.

Eine reine Bluetooth-Soundbar ist kein Spotify-Connect-Gerät und erscheint deshalb nie separat in
der Liste. Bei der bisherigen Handy-Lösung bleibt das Handy die Spotify-Quelle. Die Browser-Option
nimmt das Handy vollständig aus dem Wiedergabepfad und reicht den Ton über den Audioausgang des
Musik-PCs an TV oder Soundbar weiter.

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
  unverändert. Der ursprüngliche Jam-Tab und der Kiosk prüfen die Freigabe danach automatisch erneut;
  ein manueller Reload ist nicht nötig.
- Die lokale Seite zeigt beide Verbindungszustände getrennt, kann sofort einen neuen Versuch
  auslösen und bietet unter **Verbindung verwalten** als letzte Option einen vollständigen Reset.
  Einen neuen Download braucht es nur auf einem Ersatzgerät oder wenn die lokale Installation
  tatsächlich fehlt.

## Datenschutz und Berechtigungen

Client-ID sowie Spotify-Zugriffs- und Refresh-Token liegen ausschließlich lokal in
`~/.respawn/jam-controller.json`. Der Respawn-Server speichert davon nichts in SQLite oder GitHub,
sondern nur einen gehashten Controller-Schlüssel und öffentliche Wiedergabedaten. Für die optionale
Browser-Ausgabe liefert der Controller dem Browser auf demselben Rechner einen kurzlebigen Token
über `127.0.0.1`; die lokale Schnittstelle akzeptiert ausschließlich die im Controller konfigurierte
Respawn-Origin. Der Controller ist
kein Respawn-Spieler und erscheint nicht in Spielerlisten oder Statistiken. Nur Gruppen-Owner und
Admins dürfen ihn koppeln oder entkoppeln; die gemeinsame Musiksuche und Wiedergabesteuerung steht
allen aktiven Gruppenmitgliedern offen.

Technischer Hintergrund: [Spotify Authorization Code mit PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow),
[Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)
und [Vorgaben für Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
sowie [Refresh-Tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens).
