# Branch: `codex/spotify-playlist-search`

## Status

Lokaler Arbeitsbranch, noch ohne Pull Request.

## Themenstrang

Fortführung des Spotify-Jams: Die gemeinsame Suche liefert Titel und ganze Playlists in einem
stabilen Ergebnisblock mit vollbreitem Zwei-Button-Umschalter. Eine bestätigte Playlist ersetzt die
aktuelle Wiedergabe und offene Songwünsche, bleibt als Spotify-Kontext aktiv und zeigt unter
„Als Nächstes“ die noch folgenden Playlist-Titel. Zusätzliche Songwünsche stehen separat und laufen
in Eingangsreihenfolge; Sortieren und Entfernen bleiben während des Playlist-Kontexts ausgeblendet,
weil Spotify diese Eingriffe in seine Live-Warteschlange nicht anbietet.

Der Download ist nur noch für die erste Installation oder ein tatsächlich fehlendes Musikgerät
gedacht. Die Startdateien installieren Controller und private Laufzeit einmalig unter `.respawn`.
Danach genügen Autostart oder dieselbe Startdatei. Der laufende Controller überbrückt vorübergehende
Respawn- und Spotify-Ausfälle automatisch, unterscheidet eine nötige Respawn-Wiederkopplung von
einer abgelaufenen Spotify-Anmeldung und bietet beides auf seiner lokalen Statusseite separat an.
Ein vorhandener Controller kann mit einem frischen Code ohne neues Paket wieder gekoppelt werden.
Die vollständige Einrichtung, Bedienung und Fehlerbehebung steht in [`docs/JAM.md`](../../JAM.md).

Die Jam-Oberfläche hält Fokus und Scrollposition bei Live-Aktualisierungen stabil. Der Hilfe-Tooltip,
das generierte Controller-README, die lokale Controller-Seite, die Root-Dokumentation und das
Design-System beschreiben denselben aktuellen Ablauf.
