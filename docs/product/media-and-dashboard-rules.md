# Produktregeln: Medien und Dashboards

Diese Datei enthält die aus dem Designkern verschobenen Regeln zu TV-Kiosk, Jam-Sessions und Auswertungen.

## TV-Kiosk

- **Broadcast dashboard**: The shared screen (visible name „Broadcast“, technically still
  `kiosk.html`) is a fixed, read-only TV canvas with no page or card scrollbars. A slim, calm
  header without its own surface shows the Respawn logo on the left and, on the right, the icon-only
  fullscreen toggle followed by a clock with the written-out weekday („Samstag 13:19“). Logo and
  clock line up with the outer edges of the cards. The keyboard-accessible toggle reflects whether
  browser fullscreen is active, idles out of sight in fullscreen until the mouse moves, and is
  omitted where the Fullscreen API is missing.
- **Type sizes**: The Broadcast is read from across the room and uses two text sizes only: the
  content size (`--font-size-xl`, the newsticker lead set the benchmark) for everything people
  read, card headings included, and one step smaller (`--font-size-lg`) for secondary details such
  as ages, counts, kickers and status chips.
- **Banner**: Only the newest active system notification appears below the header as one
  full-width brand-gradient banner; without one, the cards move up directly below the header.
  Title and body share one line separated by a dash and may wrap to a second line; the right side
  shows the notification's age („gerade eben“, „vor 12 Min.“, „vor 3 Std.“, „seit Samstag“)
  instead of a second clock time. A notification disappears when its topic is resolved or expires,
  when a newer one replaces it, and at the latest ten minutes after it was sent. Separate food-order summary cards are omitted because order
  pushes already use this banner.
- **Cards**: Four cards remain a 2×2 grid: Live-Status and Newsticker above Abstimmung and
  Turnier/Ergebnisse. The Jam bar sits between the banner and the cards. Banner, header and Jam bar share the card edges and the card
  content inset. A card without data centers one short line at content size in the whole card.
- **Live-Status**: shows every participant including offline ones, alphabetically by name regardless
  of status so live updates never move people around. Like Home, but
  without the own pause toggle („Dein Status“), a single-line strip beside the Live-Status heading
  names each running game with its player count (people icon plus number, „N Spieler“ as accessible
  name), largest group first; it is omitted while nobody plays and never wraps: game names stay
  whole, games that do not fit, the smallest groups first, are summed up in one compact „+N“ label
  („N weitere Spiele“ as accessible name). The largest game's whole name comes before that label;
  only a largest game too long on its own shortens its name, never below about six characters next
  to its count. Each player row shows an avatar, name, and status marker: a glowing green diamond for
  „Spielt“, a filled blue circle for „Online“, an amber ring for „Pause“ and a hollow grey ring for
  „Offline“. In forced colors, the diamond and circle remain filled, the pause ring is dashed and
  the offline ring is solid. The German state stays available as the marker's accessible name and tooltip. The roster
  uses four columns on wide cards and fewer on narrow cards, budgeting 140 px per column including spacing. Short
  rosters stretch their row surfaces across the available card height while text, avatars and markers keep their
  established size. Long player names are shortened
  with an ellipsis instead of
  widening a column. If the roster exceeds the available height, the rows tighten first. Larger
  rosters rotate pages, marked by dots. The game counts
  stay in the heading while pages rotate. On narrow cards the strip sits below the heading text.
- **Newsticker**: a timeline of playful, clearly invented headlines. The server writes one new
  line every three to ten minutes for the whole event, so every Broadcast screen of that event shows the same
  feed; a new feed starts with a full set of ten lines. A screen that runs on a signed-in account
  instead of its Broadcast token shows the feed of that account's active event, like every other
  card. If the feed cannot be loaded before any line was shown, the card says „Newsticker gerade
  nicht erreichbar.“ and keeps retrying. Fresh real results (matches and tournament fixtures of the last 90 minutes) are reported
  first and each only once. Bei sichtbaren LAN-Punkten kommen offene Wettmärkte und Abrechnungen
  hinzu („Wetten offen: A gegen B“, „B gewinnt, 2 von 3 lagen daneben, Topf 30 P.“). Ersetzte,
  geschlossene Öffnungen, korrigierte Abrechnungen und ausgeblendete Punkte verschwinden auch aus
  bereits gespeicherten Wettzeilen mit dem nächsten Abruf; wo Namen nicht freigegeben sind, steht
  „Anonymes Team“. Testkonten werden nur in Testevents genannt. Where the event records play time,
  long ongoing sessions and daily play-time milestones are used as well. Otherwise a line combines a real participant with a game
  from the group's catalog (a few well-known games when the catalog is empty). Anti-repeat rules
  keep an identical line out for two hours, a sentence form for 20 lines and the same person out
  of two consecutive lines. The newest line leads as „Eilmeldung“ with a gradient icon, one text
  size above the other lines at a medium weight and its game or tournament as meta line; older lines sit below it on one vertical rail,
  each with its icon and age. The card shows at most seven lines; the remaining height is shared out
  below them, twice as much after the lead as between the others, so the lines spread over the card. The lead
  headline is never cut short: on a short card it first steps down in size (dropping its meta line,
  then its kicker) before older lines give way; generated lines stay within 170 characters. A new line fades in on top while
  the others slide down; lines that no longer fit on a short screen are dropped, and reduced motion shows the new state without movement. The tone
  stays friendly: no remarks about looks, weak skill, health or private life. Accounts that opted
  out in Mein Profil are never named, and a line naming them disappears with the next refresh.
- **Abstimmung**: Vote is a live room display. Parallel open rounds take turns every ten seconds.
  The displayed round vertically centers its participant
  count in the status header and show the current ranking in one column, with every game name
  replaced by a stable, differently sized random-character mask plus blur so the room display
  cannot influence voting. Single-choice runoffs are explicitly labeled „Stichwahl“. The muted
  line below the heading — of the running round and of the revealed result — names the title and
  the starter („von <Name>“); like in the Vote view, legacy rounds and deleted starters show no
  name. Rows keep
  their normal size; the card shows as many as fit and re-fits whenever its height changes, for
  example when entering fullscreen. After a round closes, a five-second countdown hides every
  result and reuses Arcade's large layered gradient/glow number with its per-second pop effect.
  The revealed view starts at the top: the standard section title „Gewinner“ introduces a
  separately purple-pink gradient-bordered winner surface (including every tied winner), and the
  smaller title „Ergebnis im Detail“ introduces the neutral ranking without repeating the winner
  border. The result is shown alone for ten seconds after reveal, then takes turns with any
  already open rounds every ten seconds until its ten-minute expiry, based on the persisted close
  timestamp. A round started after the result replaces it immediately. Without an open or recently closed round, the card only
  states that no vote is running. The regular personal Vote view keeps its open-round
  distribution hidden.
- **Ergebnisse**: Die bestehende Turnierkachel zeigt die zehn zuletzt erfassten oder korrigierten
  gültigen Match- und Turnierspielergebnisse. Spiel, Anzeigenamen/Team, Platzierung und tatsächlich
  gebuchte Spielpunkte stehen in einer Tabelle; keine weiteren persönlichen Angaben.
  Änderungen erscheinen als „korrigiert“, auch reine Score-Korrekturen. Ohne Punkteanzeige fehlen
  die Punktespalte und Punkteranglisten; Ergebnisse bleiben sichtbar. Bei vorhandenem Turnier
  wechseln die Ansichten alle zehn Sekunden. Bei sichtbaren LAN-Punkten rotieren zusätzlich alle
  vier Ranglisten (Gesamt, Wetten, Orga-Punkte, Spielpunkte) sowie je Turnier der Turniersieger-Markt
  und seine offenen, geschlossenen oder abgerechneten Spielmärkte. Die Wettseiten zeigen Topf,
  Tippzahl und Einsätze sowie die Tippenden je Team, nach Abrechnung das siegreiche Team mit seinen
  Tippenden. Quoten und Gewinnschätzungen fehlen. Jede Rangliste zeigt Platz und Punkte: im Gesamtstand
  die Summe der Kategorie-Platzpunkte, in Kategorien ihren Rohwert. Opt-out-Konten und Testkonten außerhalb von Testevents bleiben in
  Tipps und Ranglisten anonym; Werte und Platzierungen bleiben erhalten. Lange Teilnehmerlisten werden innerhalb der
  Kachel
  automatisch paginiert; die Begrenzung auf zehn Ergebnisse beschränkt keine Punktegutschriften.
  Neue Ergebnisse und Sichtbarkeitsänderungen werden per Realtime, zusätzlich alle 60 Sekunden,
  geladen. Ein fehlgeschlagener Abruf verbirgt Punkte bis zum nächsten erfolgreichen Abruf.
- **Turnier**: Standings and group phases start directly below their metadata; in a knockout
  view, game and round remain fixed at the top while the bracket round is centered below, with
  matches side by side; a third-place match follows the final with the caption „Spiel um Platz 3“.
  All variants use bordered standing, group or match cards with textual
  winner states. Low-height canvases reduce only row padding and gaps so the dashboard still needs
  no scrollbar. Without a tournament the card title reads „Turnier“ and the card states that no
  tournament exists.

## Jam-Sessions und Analytics

- **Jam sessions** — Jam is a grouped page below „Mehr“. Its page heading carries no info tooltip.
  The setup card is shown whenever no controller is paired yet or
  the paired one is offline, so the unconfigured state is not silently empty. It presents the complete
  setup as four numbered hairline rows: start the package on the music PC, pair it with Respawn,
  connect Spotify, then start the Jam. Step 1 carries „Paket herunterladen“ and step 2 „Code erzeugen“
  in one fixed, right-aligned column of equally wide compact buttons; the gradient marks the next
  step (the download for a new setup, the code for a known but offline controller). A generated code
  replaces that button with the code in regular type plus a copy icon, the step's description adds
  „10 Minuten gültig“, and the button returns once the code expires. The pairing step shows the
  loopback address as a clickable link for the music PC. Members without controller rights see one
  compact empty card instead of the steps.
  A dedicated local controller on the
  playback PC or kiosk Raspberry Pi connects Spotify through PKCE and never appears as a player.
  The server stores neither Spotify application credentials nor OAuth tokens. One participant
  starts a session on an explicitly selected playback device; this player is the host. Before a session the card „Jam starten“ names the controller in one meta
  line, loads the Spotify devices on its own and offers one labeled „Musikausgabe“ select of limited
  width with the „Starten“ button beside it. All active
  group members share pause, resume and skip controls and search the same catalog for tracks and
  playlists. „Jetzt läuft“ shows the track flat in its card with artist, requester and progress in
  gray meta text; „Pausiert“ is text, not a badge. Its header carries a neutral „Beenden“ for the
  host and admins with a red confirmation; compact, equally wide „Pausieren“/„Fortsetzen“ and
  „Überspringen“ end the card on the right, and an idle device reads as the shared centered empty
  state. „Als Nächstes“ follows directly below „Jetzt läuft“ before the search card „Musik
  hinzufügen“. Search results stay inside one stable block: two compact „Titel“/„Playlists“ buttons
  without counts switch the result type, the active one outlined in blue, and results form a quiet
  table with one fixed „Hinzufügen“ or „Abspielen“ column. A playlist
  result starts its complete Spotify playback context and replaces the
  current playback plus pending requests after explicit confirmation. While that context is active,
  „Als Nächstes“ reads Spotify's live queue and lists the next five songs in Spotify's order,
  playlist songs and requests alike (a controller package downloaded before this change reports
  only the next song until it is downloaded again). Below them it shows how many further playlist
  songs remain. A request removed during the playlist is left out of that list.
  The same song may be requested several times; each copy is its own request with its own
  requester and position. When a song ends and the identical song starts again from the
  beginning while a copy still waits, that copy becomes the playing request.
  Those requests follow Spotify's append-only queue in request order; reordering stays hidden
  while a playlist is active because Spotify exposes no reorder for its live queue. Removing a
  request still works: it leaves Respawn's queue immediately, and because Spotify cannot drop it
  from its own queue, the Jam skips that song the moment Spotify starts it. An active playlist has
  no separate remove action; it finishes naturally, is replaced by another explicitly confirmed
  playlist, or ends with the Jam. Requests form a quiet table without column headers and
  with equal row heights: position, small artwork, title (shortened after 40 characters) above the
  artist, requester (the viewer's own name in bold) and duration; on phones the requester joins the
  artist line. Their order is the shared queue order. Titles are static text. On fine-pointer
  devices the complete request row is draggable without a permanent handle: dropping between rows
  reorders it, and starting a drag reveals a fixed trash target that removes it on drop. Keyboard
  users focus the row and use the arrow keys or Delete. Touch layouts expose one trailing management
  action with the available „Nach oben“, „Nach unten“ and „Entfernen“ alternatives. Every member may remove
  every request; when no playlist controls the order, every member may also reorder them. Respawn
  persists that order and replaces the active Spotify URI context at the current playback position
  so the visible order also becomes the actual playback order.
  The kiosk reuses a single compact full-width music bar between the banner and the dashboard cards.
  It uses smaller artwork and exactly two text lines per side: title above artist/requester, without
  separate „Jetzt läuft“ or „Als Nächstes“ labels. Current progress and time share the metadata line.
  The bar shows the actual next track without exposing controls or Spotify credentials. If
  Spotify has not exposed a next track yet, it shows the playlist's shuffle state, remaining count
  and waiting song requests instead of an empty request message. The fixed
  music bar offers one local setup action before a session when the Jam controller runs on that
  kiosk device. It registers the kiosk browser as a Spotify Connect player, so its audio follows the
  computer's HDMI/TV output; after activation the kiosk returns to its read-only display role. A
  reloaded local browser exposes a recovery action for the still-running Jam. Recovery preserves
  session and queue state, and the server only retargets playback to a newly registered Spotify
  device whose name exactly matches the session's previous device. The otherwise read-only kiosk
  credential is accepted only for this exact recovery PATCH; every other kiosk mutation remains
  behind participant authentication. The
  regular Jam device picker exposes the same local-browser path only on the controller computer and
  explains that a Bluetooth-only soundbar is an audio output rather than its own Spotify device. The fixed
  loopback redirect `http://127.0.0.1:43821/callback` makes controller setup independent of the
  Respawn server URL. A short-lived pairing code replaces an existing controller; only its hashed
  credential and public playback/queue metadata reach the server.
  The setup card offers a fresh pairing code independently from the generated controller ZIP, so an
  already installed controller can always be paired again without another download. Explicitly
  disconnecting a controller immediately creates and displays such a code; the ZIP remains the
  secondary first-installation or recovery fallback instead of becoming the only available action.
  The package needs neither repository nor `npm` instructions.
  It contains prefilled server/pairing data and platform launchers for macOS, Windows and Raspberry
  Pi/Linux; the first launch installs the controller and its isolated runtime once below the user's
  `.respawn` directory. Its local status page mirrors the app's compact controls and shows states as
  text without color. It can enable login autostart and retry immediately through two equally wide
  buttons. Its collapsible „Verbindung verwalten“ re-pairs even a connected installation with a
  fresh code and another Respawn address, renews Spotify authorization independently and resets the
  controller only after a required confirmation checkbox, with both actions side by side.
  Respawn's offline state therefore offers reconnection first and a new download only as a fallback.
  Controller requests have bounded timeouts and retry automatically after transient network errors.
  Current playback is reported independently from the slower Spotify queue lookup, so queue latency
  cannot hold the progress display back. A short Spotify status failure keeps the last successful
  playback and connected state for 30 seconds; only a sustained outage shows the recovery message.
  Spotify rate limits are retried after the advertised delay.
  Every group owner and admin can end the active Jam and then explicitly disconnect the controller
  through the collapsible „Verbindung verwalten“ card with a neutral „Entkoppeln“ and a red
  confirmation.
  A controller without an active Jam is removed automatically after 24 hours without a heartbeat;
  reconnecting it only needs a fresh pairing code and retains its local Spotify authorization.
  The controller heartbeat remains online when Spotify is temporarily unavailable and omits the
  unavailable playback snapshot so the server retains the last confirmed track. An invalid Respawn
  credential explicitly requests re-pairing; an expired or revoked Spotify refresh token explicitly
  requests only Spotify reauthorization, never an unnecessary controller reinstall. Realtime
  playback refreshes retain the current Jam DOM while new status is fetched; active controls keep
  focus and the view preserves its internal scroll position instead of flashing a loading state.
- **Analytics** — the „Statistiken“ tab of the „Auswertung“ area: one page without sub-tabs, so
  only the area tab row sits above the content. The first card „Überblick“ carries the event
  dropdown („Alle Events“ first, with a calendar icon so its text lines up with the event
  options) in full width below its title, like the pickers in Rangliste and
  Hall of Fame, and the totals as one row of centered figures, the same overview „Meine Statistiken“ uses: play
  time, sessions, matches, tournaments, draws and arcade matches. There are no additional date
  controls. Play time and match data use the selected event directly; Arcade internally derives
  the event's date bounds because arcade results have no event assignment. The daily match chart
  is omitted. Below follow, each as a collapsible card that starts collapsed, shows its row count
  and keeps its open state across re-renders and filter changes: „Spielzeit pro Spieler“,
  „Beliebteste Spiele“, „Längste Session pro Spiel“, „Awards“, „Ergebnisse pro Spiel“, „Turniere
  pro Spiel“, „Team-Auslosungen“, „Arcade pro Spiel“, „Trivia“ and „Session-Protokoll“. An empty
  list is the one-row empty card. All lists use the shared RankedList: counts are numbered
  rankings with shared places for equal values, play times are numbered by position, Awards and Trivia are alphabetical value
  lists, and the Session-Protokoll lists the newest session first. Trivia also carries the share
  of draws that set seat neighbours against each other. No section carries an info tooltip.
  The former „Witzige Rekorde“ section uses the concise title „Trivia“.
  Its empty state is symbol-free and avoids repeating that title.
