# Produktregeln: Medien und Dashboards

Diese Datei enthält die aus dem Designkern verschobenen Regeln zu TV-Kiosk, Jam-Sessions und Auswertungen.

## TV-Kiosk

- **Kiosk dashboard** — Kiosk is a fixed, read-only TV canvas with no page or card scrollbars. Its
  header offers a keyboard-accessible „Vollbild“ toggle and reflects whether browser fullscreen is
  currently active. Browsers without Fullscreen API support omit the unavailable control.
  Its
  four primary cards remain a 2×2 grid and distribute live players, rankings, tournament standings,
  groups and matches across internal columns, ordered Live-Status and Rangliste above Abstimmung
  and Turnier. Vote status is a centered icon/text stack. Only the
  newest active system notification appears above the dashboard as one full-width brand-gradient
  banner; separate food-order summary cards are omitted because order pushes already use that banner.
  Tournament standings and group phases start directly below their metadata. In a
  knockout view, game and round remain fixed at the top while the bracket round itself is centered in
  the remaining card area. All variants use bordered standing, group or match cards with textual winner
  states, matching the main app's nested-surface hierarchy. Vote is a live room display: open rounds
  vertically center their participant count in the status header and show their current ranking as
  „Zwischenstand“, but replace every game name with a stable, differently sized random-character
  mask plus blur so the room display cannot influence voting. Single-choice runoffs are explicitly labeled
  „Stichwahl“. The two-column live ranking uses the complete remaining card height for up to ten
  games, distributing its five rows evenly instead of compressing them at the top. Low-height TV
  canvases reduce only row padding and gaps so the fixed dashboard still needs no scrollbar. After
  a round closes, a five-second countdown hides every result and reuses Arcade's large layered
  gradient/glow number with its per-second pop effect. The revealed view starts at the top rather
  than floating vertically centered: the standard section title „Gewinner“ introduces a separately
  purple-pink gradient-bordered winner surface (including every tied winner). The smaller standard
  section title „Ergebnis im Detail“ then introduces the complete neutral ranking; its leading rows
  do not repeat the winner border. The result remains visible for ten minutes,
  based on the persisted close timestamp; then the card switches to the empty state. A new
  open round replaces that result immediately. Without an open or recently closed round, the card
  only states that no vote is running. The regular personal Vote
  view keeps its open-round distribution hidden. Without a tournament, the tournament card uses
  the concise empty state „Kein offenes Turnier.“.

## Jam-Sessions und Analytics

- **Jam sessions** — Jam is a grouped page below „Mehr“. Its page heading always exposes an info
  tooltip explaining the shared title/playlist workflow, controller lifecycle and that only the
  controller device needs Spotify. The setup card is shown whenever no controller is paired yet or
  the paired one is offline, so the unconfigured state is not silently empty. It presents the complete
  setup as four ordered steps: prepare the music PC, pair it with Respawn, connect Spotify, then choose
  the audio output. The pairing step shows the loopback address as a clickable link for the music PC.
  A dedicated local controller on the
  playback PC or kiosk Raspberry Pi connects Spotify through PKCE and never appears as a player.
  The server stores neither Spotify application credentials nor OAuth tokens. One participant
  starts a session on an explicitly selected playback device; this player is the host. All active
  group members share pause, resume and skip controls and search the same catalog for tracks and
  playlists. „Als Nächstes“ follows directly below „Jetzt läuft“ before the search workflow. Search
  results stay inside one stable block and use a full-width two-button switch built from the shared
  secondary and primary button treatments to switch between titles and playlists. Both choices get
  equal space, and only the active result type receives primary emphasis. A playlist
  result starts its complete Spotify playback context and replaces the
  current playback plus pending requests after explicit confirmation. While that context is active,
  „Als Nächstes“ reads Spotify's live queue and names the actual next track. It then shows the
  remaining playlist-track count separately from additional song requests.
  Those requests follow Spotify's append-only queue in request order; reorder and remove
  controls stay hidden because Spotify exposes neither operation for its live queue. Requests use stable full-width rows with artwork,
  title, artist and requester instead of pills; their order is the shared queue order. The current
  track is the most prominent nested surface, with progress and host controls directly attached.
  Members can reorder two or more queued requests through native drag-and-drop or the equivalent
  arrow controls. Respawn persists that order and replaces the active Spotify URI context at the
  current playback position so the visible order also becomes the actual playback order.
  The kiosk reuses a single compact full-width music bar below the fixed dashboard and shows current
  track, progress and the actual next track without exposing controls or Spotify credentials. If
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
  `.respawn` directory. Its local status page can enable login autostart, retry immediately, renew
  Spotify authorization independently and re-pair an existing installation with a fresh code.
  Respawn's offline state therefore offers reconnection first and a new download only as a fallback.
  Controller requests have bounded timeouts and retry automatically after transient network errors.
  Every group owner and admin can end the active Jam and then explicitly disconnect the controller.
  A controller without an active Jam is removed automatically after 24 hours without a heartbeat;
  reconnecting it only needs a fresh pairing code and retains its local Spotify authorization.
  The controller heartbeat remains online when Spotify is temporarily unavailable and omits the
  unavailable playback snapshot so the server retains the last confirmed track. An invalid Respawn
  credential explicitly requests re-pairing; an expired or revoked Spotify refresh token explicitly
  requests only Spotify reauthorization, never an unnecessary controller reinstall. Realtime
  playback refreshes retain the current Jam DOM while new status is fetched; active controls keep
  focus and the view preserves its internal scroll position instead of flashing a loading state.
- **Analytics** — the „Statistiken“ tab of the „Auswertung“ area. Its own three datasets
  (Spielzeit, Matches & Turniere, Arcade) stay an in-card control group under the visible heading
  „Ansicht“, which is what separates them from the area tab row above. All three share the same
  event dropdown and show no additional date controls.
  Playtime and tournament data use the selected event directly; Arcade internally derives the
  event's date bounds because arcade results have no event assignment. The daily match chart is
  omitted. Tournament formats and per-game tournament counts are separate nested groups with blue
  and pink accent rails.
  The former „Witzige Rekorde“ section uses the concise title „Trivia“.
  Its empty state is symbol-free and avoids repeating that title.
