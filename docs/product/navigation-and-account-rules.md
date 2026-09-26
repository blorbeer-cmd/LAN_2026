# Produktregeln: Navigation und Konto

Diese Datei enthält die aus dem Designkern verschobenen Regeln zu Routen, Rollen, Kontozuständen und produktbezogener Navigation. Globale Gestaltungs- und Accessibility-Regeln stehen weiterhin im [Designkern](../../server/DESIGN_SYSTEM.md).

## Navigation, Rollen und Fachtexte

9. **Reuse canonical semantics.** Navigation and „Mehr“ define domain icons through
   `domainIcons.js`; all other appearances reuse those mappings. Visible German page labels stay
   concise (`Teams`, `Vote`, `Orga`, `To-Do`, `Info`, `Trivia`, `Historie`), while longer explanations and
   former labels may appear only in help text or technical documentation where needed.
10. **Keep account management behind the authenticated boundary.** The current roster is readable
    by every signed-in member, while only the session account can edit its own profile. Player
    creation, deletion, roles and foreign-profile editing remain admin-only actions.
11. **Match primary navigation to the event type.** For LAN events, primary navigation carries exactly
    the six during-party destinations Home, Match, Vote, Essen, Spiele and Mehr. A general event
    instead promotes its planning workflow to Home, An & Abreise, Packliste, To-Do, Umfragen
    and Mehr; the remaining destinations live directly under „Mehr“. A permanent group uses the
    same game-night destinations as a LAN: Home, Match, Vote, Essen, Spiele and Mehr; its Umfragen
    and To-Dos remain together in the Orga area under „Mehr“. It is a bottom bar below
    `--bp-xl`. At `--bp-xl`, the account's Profile setting chooses between that
    compact shell and a grouped direct rail: Home, LAN, Orga and Sonstiges form the main scrollable
    area; Feedback, Events & Gruppen, role-gated Admin and Mein Profil stay pinned below it. The
    choice is stored as
    `respawn_layout_mode:<verified-account-id>`, survives logout/reload and is restored before the
    authenticated app becomes visible. Automatic is the default and resolves against `--bp-xl` on
    every breakpoint change. It changes neither routes nor permissions. The active event
    snapshot and the same role checks filter both navigation surfaces. Everything else lives under
    „Mehr“ on compact layouts, in the topbar, or (for the
    merged Rangliste/Statistiken/
    Hall-of-Fame area, „Auswertung“) inside the role-protected Admin area. Auswertung is not a
    bottom-nav destination: reaching it now always requires the real owner/admin role
    (`switchView()`'s redirect guard in `app.js`, checked via `currentPlayerHasAdminRole()`), so it
    lives behind Admin's „Auswertung“ tool card (see „Admin tools“) rather than sharing a
    conditional bottom-nav slot with Essen the way it once did — Essen now has that slot
    unconditionally, for every device. Where two or three
    closely related workflows would otherwise each claim their own entry, they become tabs of one area (see
    `sectionNav.js`). Every tab keeps its own route, so deep links, the back button and persisted
    push urls stay valid, and a tab never nests inside another tab row — a merged area flattens the
    sub-view's own tabs into its area tab row.

## Bereich-Tabs

- **Area tabs** — `.section-tabs` with `.section-tab` is the tab row of a merged top-level area
  (Match, Auswertung and compact LAN/group Orga; defined in `sectionNav.js`). General events present
  every Orga route as a standalone page with its own title because those routes are their primary
  navigation, not a secondary Orga collection. A group instead keeps Umfragen and To-Do as the two
  tabs of its secondary Orga area. Match and Auswertung use `.section-page-header`; LAN/group Orga
  uses `.more-subpage-header--tabs` on phone and laptop layouts. Those headers place tabs
  on a dedicated second row and share the intentional lower first-card edge. Desktop LAN/group Orga
  hides the duplicate tabs and shows the opened page's title in the compact header. Every tab row
  remains outside any card, distinct from the in-card controls further down. Each tab is a real
  route, so the row is `<nav>` navigation rather than a toggle: the active tab carries
  `aria-current="page"` plus `.btn-primary`, never `aria-pressed`. Tabs and rail entries carry
  their plain label, never a count. Tabs share the full width on phones for a comfortable tap
  target and size to their own label from `--bp-md`, because two tabs stretched across the wide
  content column would read as banners rather than navigation. A primary action belongs in the
  first relevant card header when that card exists (for example „Ergebnis eintragen“ beside
  „Rangliste & Spielzeit“), so it does not insert a detached row between tabs and content.
  Re-rendering the same tab reuses its existing `.section-view` element instead of rebuilding the
  shell, so a sub-view that reads its own previous DOM before redrawing (the Packliste's add-item
  draft and focus, the same survives-its-own-rerender pattern the Checkliste's To-Do form uses)
  keeps working across a background refresh triggered from outside that tab.

## Benachrichtigungszentrum

- **Notification center** — `.notification-highlight` exposes the newest active unread entry as a
  brand-gradient direct link below the topbar and follows its domain/expiry lifecycle;
  `.notification-center` with `.notification-center-panel`, `.notification-center-toolbar` and
  `.notification-center-entry` keeps the full personal history plus read/remove state. Each entry
  is one flat row: its whole text block (title, body capped at two lines, one muted meta line with
  event, time, „Für dich“ and state) is the link that opens the target and marks it read; an entry
  without a target is only marked read. The remove action keeps a fixed muted column on the right.
  Unread entries read in full contrast with a bold title, without an accent edge, pill or „Neu“
  badge; read and obsolete entries recede to muted text. Obsolete entries (their underlying
  workflow resolved, or their own expiry passed) end their meta line with „Beendet“ or
  „Abgelaufen“ and never count as unread. The sticky footer holds neutral bulk actions in equal
  columns across the full width: „Alle gelesen“ and „Alle löschen“ (whose confirmation stays red),
  preceded by „Aufräumen“ only while at least one obsolete entry is present.

## Eventauswahl

- **Event dropdown** — every place that picks an event uses the searchable select above with one
  shared option shape from `eventStatus.js` (`eventSelectOption`/`eventSelectOptions`): the event
  title plus its state as an icon, earliest start first; events without a fixed date follow the
  scheduled events. That covers the topbar workspace switcher
  (`#event-context`), Auswertung's shared filter, „Meine Statistiken“ and Hall of Fame's „Nach
  LAN“ picker. They previously described the same events in three different ways — one appended
  the date range, another showed the bare name, and none showed the state until after a choice had
  been made. The date range is deliberately gone: `eventStatus.js`'s vocabulary is what the reader
  chooses by, and the event cards in Orga remain the place that shows a LAN's exact dates. A filter
  that also offers „Gesamt (alle Events)“ passes it as `allEntryLabel`; that entry is not an event
  and therefore carries no state icon. Hall of Fame's payload holds results rather than lifecycle
  flags, so it joins its events against `accessibleEvents()` for the state and falls back to a
  plain title for an event that list no longer holds. Its last entry is not a workspace at all:
  „Events & Gruppen verwalten…“ leaves the list and opens that view, because picking a workspace
  and creating one belong to the same level. The switcher is rebuilt on the active event
  immediately afterwards, so the entry never becomes the visible selection. A group carries its own
  state icon there while it runs, because it has no other state to report: it never tracks and has
  no period. It can still be ended like any other workspace, and an ended one reports „Beendet"
  instead of its own kind.

## Profile und Admin

- **Player profiles** — There is no separate roster area: Home's Live-Status already lists everyone,
  so every card there is a button that opens that participant's read-only detail dialog. The card
  of the session account is marked „(du)“ and opens the dedicated self-service profile editor
  instead. A global-search hit on a person behaves the same way — the dialog opens over the current
  view rather than navigating away from it. The card's children stay `<span>`s carrying only display
  styling — a `<button>`'s content model is phrasing content, and its descendants are presentational
  to assistive technology once an `aria-label` is set — so the live state and running games are
  spelled into that accessible name itself instead of only appearing as visible child markup.
  Foreign profiles expose neither edit/delete actions nor the private agent key;
  the API omits the private agent key and rejects profile-field updates when the session does not
  match the target player.
  A foreign profile's detail dialog names the Gamertag once, as its title, and leads with the
  avatar, the real name and how many games the person rated. One table follows with one row per
  rated game and the columns Spiel, Bock and Skill (games without any value are left out, a missing
  single value shows „–“). The column headers sort like the An- & Abreise table; the dialog opens
  sorted by Bock, highest first, because that order carries meaning.
  Player creation stays in the authenticated Admin workflow. The desktop live board keeps exactly
  two equal-width cards per row; an odd final player does not stretch.
  The self-service profile is one column of full-width cards whose settings are hairline rows:
  title, a muted meta line and one compact neutral action in a fixed right column. It carries no
  contextual-help tooltips. The account card has no heading and holds the identity row (avatar
  with its color dot, Gamertag, Name, „Speichern“; phones wrap Name below), the view preference as
  a native select, push notifications and „Passwort ändern“, which opens a dialog. A card named
  after the active event holds the rating nudge „Bock & Skill“ (only while nothing is rated),
  „Meine Statistiken“ and „Sichtbare Monitore“, whose „Bearbeiten“ dialog lists chosen players
  first, then the rest, with one search field for both; the split is taken when the dialog opens
  so rows never jump while boxes are ticked. „Live-Status & Agent“, „Datenschutz“ and „Meine
  Daten“ are collapsible cards that start collapsed and keep a manual open state across
  re-renders.
  „Live-Status & Agent“ shows tracking as a row with „Pausieren“/„Fortsetzen“ and a „Mehr
  erfahren“ dialog that states what the agent reads on the PC, what reaches the server and what
  it is used for, followed by three numbered steps: download (with „Erweitertes Tracking für
  diesen Download“ as a per-download option), install and „Ohne Windows“ with „Key kopieren“ and
  a quiet „Key erneuern“ whose confirmation stays red. Live status, playtime and derived
  evaluations apply only to the account's currently selected, running event with accepted
  participation, enabled tracking and valid event consent; without that context, the agent
  receives no process allowlist and no matched process names reach storage or admin diagnostics.
  The event tracking tooltip and start confirmation explain the same prerequisites.
  „Datenschutz“ shows the consent text with „Mehr erfahren“ (purpose, visibility,
  pre-authorization and export in one dialog), then one row per trackable event with
  „Erlauben“/„Widerrufen“; the base workspace and general events have no rows. Older event
  consents never count as active and remain revocable as rows; the base event's old consent and
  the old group consent from before event-bound tracking are not listed. Set apart below the
  changing event list, a standing pre-authorization („Neue Events und Gruppen vorab erlauben“)
  lets an account agree in advance to events and groups that only become trackable later. It is
  bound to the text version it was set under and never overrides a single event's own decision.
  Technical retention rules and operator decisions remain in the documentation rather than the
  member profile. „Meine Daten“ provides a secret-free personal JSON export and a
  reauthentication-protected account deletion with concrete remedies for roles or open
  organisational work that must first be transferred.
- **Admin tools** — Account invitations and claim/reset links live in Admin's authenticated
  onboarding group; their QR codes open in the shared centered modal.
  Frequently used „Werkzeuge“ lead the authenticated content. A compact „LAN-Bereitschaft“ group
  follows: its overall badge stays directly visible, while the responsive check cards for
  Server/SQLite, Event and participants, agent coverage/version, process mappings, Kiosk and the
  latest persistent backup start inside „Prüfdetails“. Every card pairs its semantic badge with a
  textual summary and actionable detail; loading and retry errors stay inside the group.
  In Desktop mode, Werkzeuge/Bereitschaft and Kontozugang/Testdaten form two priority rows. Benutzer
  and Agent-Diagnose then span the content width and lay out their repeated entries in three columns.
  Long diagnostics remain below the frequent tools instead of narrowing the complete admin workflow.
  Backup and seating-plan editing are absent from regular member views and live
  together as nested tool cards in the role-protected Admin area. Admin settings and tools remain
  visible to owners/admins without activating the device-local Admin mode; that mode only reveals
  test players and test-data controls throughout the app and enables Arcade AI matches. The leading
  tool card, „Auswertung“, is the sole entry point into the merged Rangliste/Statistiken/Hall-of-Fame
  area: it used to be a conditional bottom-nav destination gated by the device-local Admin mode
  (sharing that slot with Essen), but now lives only here, gated by the real admin role like the
  rest of Admin — the same standalone, role-protected pattern as „Kioskverwaltung“ below, not a
  shortcut into an otherwise generally-reachable tab. A further
  tool card, „Eventverwaltung“, links into Orga's „Events“ tab — that global, non-personal
  management surface is otherwise only reachable through „Mehr“ like any other Orga tab. „Kioskverwaltung“
  is different: TV-Kiosk is not an Orga tab at all, so this card is its only entry point, a
  standalone role-protected route of its own (the same pattern as „Sitzplan“) rather than a link
  into a tab row. Each tool card keeps its
  title, adjacent help tooltip and colorful primary action on one row; the seating and kiosk
  editors both return to Admin and remain role-protected independently of that mode. Dense 2015–2026 Hall-of-Fame fixtures ship with the local test data and
  need no separate Admin action. Creating test players also maintains one Test-LAN and one general
  test event with accepted and pending test identities; both events and every aggregate fixture contribution
  stay hidden outside Admin mode. The test-data fixture explanation and the existing test-player count live in adjacent
  tooltips; the compact count input, „Test-Daten aufräumen“ and create action share one control row
  in that order. Cleanup removes every marked test player and test LAN
  without touching real events. The single-instance access context is not shown as a separate group
  control in the topbar. Owner/Admin/Member roles are managed directly in Admin's consolidated
  „Benutzer“ list; test players keep a read-only member role there.
  „Benutzer“ list; test players keep a read-only member role there. The underlying group detail,
  update, removal and audit endpoints remain server-side compatibility interfaces and intentionally
  have no separate frontend commands.
  The seating editor follows the same grouped-page hierarchy: the editable plan comes first, followed
  by „Teilnehmende“ and „Konfiguration“. Unassigned participants use the shared rectangular two-column player
  rows instead of pills; phones keep one column. Empty seats use an accent border and only the
  centered white label „Frei“, without a redundant seat number. Players without a real name omit that empty second line so their
  gamertag remains vertically centered with the avatar. The automatic monitor-neighbor and save
  behavior use adjacent info tooltips; the monitor explanation sits directly beside „Sitzplan“
  instead of occupying a separate row below the plan.

## Bereichsseiten und Mehr-Navigation

The LAN and group „Mehr“ hubs hold Events & Gruppen, Mein Profil, Admin, Arcade, Durchsage, Jam and Orga.
Events & Gruppen leads the hub for every event type: it picks and creates the workspaces the other
entries then work inside, so it sits one level above them rather than inside Orga. For a general
event, the hub replaces the Orga wrapper with a direct entry for Essen; An & Abreise, Packliste,
To-Do and Umfragen already occupy the bottom nav. A group has no Essen entry because Essen occupies
one of its own bottom-nav slots; its Orga wrapper contains only Umfragen and To-Do. Mein Profil remains here as the compact/mobile
path. From `--bp-xl`, selecting Desktop replaces the bottom bar and „Mehr“ detour visually with
a grouped direct rail: Home; LAN (labelled „Event“ for a general event and
„Gruppe“ for a group); Orga; Sonstiges; plus the bottom utilities Feedback,
Events & Gruppen, role-gated Admin and Mein Profil. The active event feature snapshot removes unavailable entries
and empty groups. Profile and Feedback are not duplicated in the desktop top ribbon; the ribbon
contains only global tools. The account-scoped Automatic/Desktop/Laptop choice lives in Mein
Profil so it remains reachable in every shell. Essen is listed in „Mehr“ only for
general events; LAN events and groups retain its
unconditional bottom-nav slot (`more.js`). Auswertung is never listed here —
it has no general-audience entry point at all, living only behind Admin's „Auswertung“ tool card
(see „Admin tools“). It keeps each destination's canonical icon
directly beside its centered title so both read as one label; those icons are one spacing step smaller than standard list-row icons and
use the wider section gap to keep icon and text visually distinct. Only the navigation chevron
remains independently aligned at the right.
The destinations below „Mehr“ follow this same hierarchy without adding decorative accent rails:
their major workflows and datasets are main groups, while entries, players, orders and results
remain subordinate cards or rows inside those groups. Phone and laptop destinations return to
„Mehr“ from the shared compact subpage header; the corresponding control is hidden on wide desktop
because the destination is already direct in the rail. Profile keeps „Abmelden“ as that header's
trailing action. Orga uses the reserved second row for its tabs only on phone and laptop layouts.

## Hall of Fame, Info und Feedback

- **Hall of Fame and Info** — Hall-of-Fame all-time rankings use the shared two-column leaderboard
  grid. „Nach Event“ uses one directly labeled event dropdown („Event suchen“) and shows the selected
  event's dates, then every overall placement, then tournament winners in the same leaderboard-row
  structure. Both result groups sit flat inside the card under plain subheadings and a hairline,
  without nested cards or accent rails; tournament game names have no decorative game symbols. Admin fixtures cover twelve years with full standings and three tournament winners per LAN so dense
  long-term states remain testable. Hall of Fame is the third tab of the „Auswertung“ area.
  Info is not an area at all: the topbar's „i“ (`#info-btn`, the canonical `info` icon from
  `domainIcons.js`) opens it as a dialog over whatever view is open, because it is reference
  material — WLAN, Discord, server IPs, house rules — that people look up mid-conversation and must
  not cost them their current workflow. Entries remain alphabetically sorted responsive two-column
  nested cards; „Eintrag anlegen“ is the dialog's leading full-width primary action, and an open
  dialog refreshes itself on `info:changed` instead of stacking a second copy. Its nested forms and
  confirmations follow the [Modal contract](../../server/frontend-contracts/components/modal.md).
- **Feedback** — the compact topbar's `#feedback-btn` and the wide desktop rail utility (both using
  the canonical `feedback` icon from `domainIcons.js`) open the same feedback dialog over whatever
  view is open. It automatically captures the view that was open when the action was used, so a
  report never needs to explain where it happened. A submission picks one
  of four distinct sentiments (Positiv, Negativ, Problem, Idee) through four equal-width toggle
  buttons spanning the message field; the chosen one carries the blue outline and a second click
  clears it. The message field starts as one line and grows with its text; „Senden“ is a compact
  gradient button at the bottom right. Besides the sender, the entry stores the active Event and a
  width bucket (Handy, Tablet, Desktop), never a user agent. Admin's Feedback page shows the open
  entries in the always-open card „Offen“ and completed ones in the collapsed „Historie“ with a
  counter, which disappears when empty and keeps its open state across live re-renders. Both use
  the calm Durchsage table without column headers: the message cut at 40 characters, the sender
  (own name bold), one muted meta line „Art · Seite · Zeit“ with the page name instead of its view
  key, and one fixed action column. Open rows carry the compact neutral „Erledigt“; completed rows
  have no row action. A toolbar like Spiele's offers „Feedback suchen“ (also matching the full
  text), sorting by „Neueste“ or „Älteste“ and a filter menu by sentiment. Clicking a row opens a
  detail dialog with the full message, sender, sentiment, page, Event, device, sent and completed
  time, and the single action „Erledigt“ or „Wieder öffnen“, which moves an entry back without
  deleting its message or captured context. There is no realtime push; „Aktualisieren“ reloads the
  inbox.

## Mein Profil, Auswertung und Home

- **Profile** — The avatar leads the identity row; tapping it picks a new picture, and a small
  color dot on its lower right opens a centered Respawn modal instead of the browser's native
  color dialog. The modal combines a keyboard-, pointer- and touch-operable hue/saturation wheel
  with a live preview, an editable and copyable `#RRGGBB` field, and explicit cancel/apply
  actions; it has no competing preset palette. Invalid hex input is visibly rejected and cannot be
  applied or copied. The chosen value remains a draft until „Speichern“ persists it. A new account
  starts with a random color whose hue lies as far as possible from the colors already in use.
  A leading „Einladungen“ card (present only while pending event invitations exist) lists each
  invitation as a row: the name shortened after 40 characters, a meta line with type, period and
  location, and „Annehmen“. Tapping the row opens a dialog with the full facts including cost and
  payment deadline and three equal buttons „Ausrede“, „Ablehnen“ and „Annehmen“. Acceptance shows
  a card „Einladung angenommen“ with a compact „Event öffnen“; the invitation becomes read
  notification history and the action switches the active event.
- **Meine Statistiken** — reached through „Ansehen“ in the profile; the navigation keeps the
  profile's highlight. The event filter sits in the title row with „Alle Events“ first. One card
  shows the key figures centered in equal columns: play time with its active share, the number of
  events (only for „Alle Events“, which names the data basis), sessions, games and parallel time.
  „Erfolge“, „Spielzeit pro Spiel“, „Spielzeit pro Event“ and „Längste Sessions“ are collapsible
  cards that start collapsed and use the shared RankedList: the rankings are sorted by value and
  numbered, Erfolge alphabetically, and every list fills its left column first. A session period
  reads „29.07., 04:10 bis 10:21“ and names the date only once.
- **Leaderboard** — the „Rangliste“ tab and default entry of the „Auswertung“ area, reached only
  through Admin's „Auswertung“ tool card (see „Admin tools“). The filtered „Rangliste“ and per-player
  „Spielzeit“ share one main card titled „Rangliste & Spielzeit“ with the game picker above them;
  each remains a distinct `.tournament-section-panel` with the shared accent rail. „Spielzeit pro
  Spiel“ stays a separate grouped page section. The selected game scopes the two accented sections
  only; „Spielzeit pro Spiel“ always keeps the all-game totals so the comparison does not collapse
  to one row.
  Every section uses `.leaderboard-list-grid`: one column on phones and two columns from `--bp-md`;
  a single row or empty state spans the full available width.
  Player and game names truncate safely without pushing points or controls outside the card; wins
  and matches remain visible as a second text line rather than depending on native hover text.
  The result dialog reuses `.tournament-section-panel` to separate „Modus“, player assignment and
  result entry. Team and free-for-all result inputs use the same aligned responsive grid.
- **Home overview** — Home follows the same full-width grouped-card hierarchy as Tournaments,
  Teams and Vote. „Aktuell“, „Live-Status“, „Rangliste“ and „Sitzplan“ are separate main cards with
  their heading inside the surface. „Meine To-Dos“ only renders once there is something to act on:
  up to three To-Dos the signed-in identity has taken over, ordered by due date, each as a compact
  row with the To-Do symbol, the title and the colour-free due text, or — while none are taken
  yet — a single row nudging toward the shared pool's still-open To-Dos; with neither, the
  tile stays hidden rather than offering an empty link into the full list. Every current
  item is a single full-row action that navigates into its source view.
  Current items and To-Dos use the same compact, divided row treatment inside their main card.
  The personal status and player entries remain nested cards on the secondary elevated background;
  „Gerade aktiv“ is a subsection of
  „Live-Status“ rather than a competing page-level group. A pending event invitation appears here as
  a plain linking nudge into „Mein Profil“ (see aktuellStatus.js); answering it happens only in
  Profile, not in this list. The live board fills its left column first, grouped by state and
  alphabetical within a state. The admin-only „Rangliste“ shows the top six as a RankedList with
  „Alle ansehen“ in its header. The seating plan draws free seats and the table as plain outlines
  labelled „Frei“ and „Tisch“, so occupied seats carry the plan; the editor's hint appears only
  while a picked player waits for a target seat. Main groups stay in one continuous column
  at phone and laptop widths while their existing internal grids remain responsive. „Aktuell“ appears
  above „Meine To-Dos“ as its own full-width main card in every layout. A general event
  replaces the LAN-only live and ranking groups with a leading event overview containing its type,
  period, optional location/note, participant count and contribution. It has no „Organisation“
  shortcut group; planning workflows remain reachable through navigation. A group without an event
  instead shows its members. Its
  overview links directly to group management. Seating is LAN-only,
  including Home's read-only plan and Admin's editor. Arcade stays available for
  both event types because its browser games do not depend on LAN tracking or competition areas.
  The personal live-state action says only „Pause“ while active and „Bin wieder da“ while paused;
  it stores the equally concise manual note „Pause“ instead of combining several possible reasons
  into one ambiguous label.

## Erstlogin

- The first-login core tour is a true modal: `#app` is inert, focus cycles inside the dialog,
  Escape skips the explanatory steps into the required rating mode, and focus returns to the
  previous control after completion. The rating panel is intentionally non-modal so its sliders
  remain usable; it stays below the shared modal layer so game details and other forms remain
  operable.
- Immediately after Home, the tour highlights the event switcher in the topbar for members and
  admins. It explains how to select the active event and that this choice scopes available areas,
  event data and actions. Orga's Events page is the overview and admin management surface; the
  analytics event filter remains a separate admin-only tour step.
