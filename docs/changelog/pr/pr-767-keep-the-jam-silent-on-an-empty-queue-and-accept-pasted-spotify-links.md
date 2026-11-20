# PR #767: Keep the Jam silent on an empty queue and accept pasted Spotify links

- Datum des Merges: 2026-11-20
- Branch: `claude/jam-empty-queue-pause`
- Merge-Commit: [`21686d3`](https://github.com/blorbeer-cmd/LAN_2026/commit/21686d3d2561f0c1de87e351f3ce8d1cfdc8f4e8)
- Pull Request: [#767](https://github.com/blorbeer-cmd/LAN_2026/pull/767)

## Changelog

- Der Jam spielt bei leerer Warteschlange nichts mehr. Der Jam-Controller verwirft die geplante Pause am Songende nur noch bei Wiedergabebefehlen (`playUris`, `playContext`, `transfer`, `pause`, `resume`, `next`). Bisher löschte auch eine Suche während des letzten Songwunschs die Pause, und Spotifys Autoplay übernahm.
- Sicherheitsnetz im Heartbeat-Abgleich: Ein Titel auf dem Jam-Gerät, der weder Songwunsch noch Teil einer aus Respawn gestarteten Playlist ist, wird pausiert, solange keine Wünsche warten. Er erscheint auch nicht als aktueller Jam-Titel. Pro Gruppe ist höchstens eine solche Pause gleichzeitig unterwegs.
- Die Jam-Suche erkennt Spotify-Links (`open.spotify.com/…/track|playlist/<id>`, auch mit `intl-xx` und `?si=`) und URIs (`spotify:track|playlist:<id>`) und zeigt genau diesen Titel bzw. diese Playlist. Playlist-Links nutzen den neuen Controller-Befehl `playlist`; ältere Controller melden verständlich, dass ein Update nötig ist. Album-, Künstler- und Kurzlinks werden abgelehnt.
- Der Jam-Controller muss auf dem Abspielrechner neu heruntergeladen werden. Spotifys eigenes Autoplay lässt sich per Web-API nicht abschalten.

## Historischer Kontext

Entstand aus der Frage, ob der Jam bei leerer Warteschlange weiterspielt, und dem Wunsch, Spotify-Links in die Suche einzufügen. Vor dem Merge gab es kein `pr-review`. Die Zusammenfassung stammt aus PR-Beschreibung und Diff.
