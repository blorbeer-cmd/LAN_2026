# Branch: `codex/spotify-music-session`

## Status

Lokaler Arbeitsbranch, noch ohne Pull Request.

## Themenstrang

Spotify-Jam für eine LAN-Gruppe: Ein Host wählt das Wiedergabegerät und startet die gemeinsame
Session. Teilnehmende suchen Titel, ergänzen und sortieren die gruppenweite Queue und teilen sich
die Wiedergabesteuerung; die Kioskansicht zeigt den aktuellen und nächsten Titel. Spotify-PKCE,
Client-ID und OAuth-Tokens leben ausschließlich auf einem gekoppelten Musik-PC oder Raspberry Pi.
Der Respawn-Server speichert nur einen gehashten Controller-Schlüssel und öffentliche
Wiedergabedaten. Der Controller benötigt kein Spielerprofil und erscheint nicht in Statistiken.
Respawn erzeugt dafür ein portables ZIP mit vorbefüllter Serveradresse und Kopplungscode sowie
Startdateien für macOS, Windows und Raspberry Pi/Linux. Die Startdatei lädt bei Bedarf eine private,
geprüfte Node-Laufzeit in den entpackten Ordner; Repository, `npm` und eine systemweite Installation
sind auf dem Musikgerät nicht erforderlich. Die lokale Einrichtung enthält eine editierbare,
vorbelegte Respawn-Adresse und kontextbezogene Hilfen für Spotify Client-ID und Redirect URI; ein
separater Anleitung-Download in Respawn entfällt. Kopplung, Paketdownload und Entkopplung sind auf
Gruppen-Owner und Admins beschränkt.
Das Beenden einer Jam-Session bleibt zuverlässig möglich, auch wenn das Spotify-Connect-Gerät den
optionalen Pause-Befehl mit einer Gerätebeschränkung ablehnt; Respawn beendet dann die Session und
zeigt einen entsprechenden Hinweis.
