# Produktregeln: Navigation und Konto

Diese Datei enthält die aus dem Designkern verschobenen Regeln zu Routen, Rollen, Kontozuständen und produktbezogener Navigation. Globale Gestaltungs- und Accessibility-Regeln stehen weiterhin im [Designkern](../../server/DESIGN_SYSTEM.md).

## Navigation, Rollen und Fachtexte

   states must retain the same geometry as the populated state.
9. **Reuse canonical semantics.** Navigation and „Mehr“ define domain icons through
   `domainIcons.js`; all other appearances reuse those mappings. Visible German page labels stay
   concise (`Teams`, `Vote`, `Orga`, `Info`, `Trivia`, `Historie`), while longer explanations and
   former labels may appear only in help text or technical documentation where needed.
10. **Keep account management behind the authenticated boundary.** The current roster is readable
    by every signed-in member, while only the session account can edit its own profile. Player
    creation, deletion, roles and foreign-profile editing remain admin-only actions.
11. **Match primary navigation to the event type.** For LAN events, primary navigation carries exactly
    the six during-party destinations Home, Match, Vote, Essen, Spiele and Mehr. A general event
    instead promotes its planning workflow to Home, An & Abreise, Packliste, To-Do, Umfragen
    and Mehr; the remaining destinations live directly under „Mehr“. It is a bottom bar below
    `--bp-xl`. At `--bp-xl`, the account's Profile setting chooses between that
    compact shell and a grouped direct rail: Home, LAN, Orga and Sonstiges form the main scrollable
    area; Feedback, role-gated Admin and Mein Profil stay pinned below it. The choice is stored as
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
  (Match, Auswertung and LAN Orga; defined in `sectionNav.js`). General events present every Orga
  route as a standalone page with its own title because those routes are their primary navigation,
  not a secondary Orga collection. Match and Auswertung use `.section-page-header`; LAN Orga uses
  `.more-subpage-header--tabs`. All three place their tabs on a dedicated second row and therefore
  share the intentional lower first-card edge. Every tab row remains outside any card, which keeps
  it distinguishable from the in-card control
  rows further down. Because each tab is a real route, the row is `<nav>` navigation rather than a
  toggle: the active tab carries `aria-current="page"` plus `.btn-primary`, never `aria-pressed`.
  A tab may carry a live count in parentheses (Orga's „To-Do“ shows the current identity's own
  open items) so the number stays visible from every tab of the area; a zero count renders no
  parentheses at all. That count is loaded once the area is entered on any of its tabs, not only the
  one that renders the underlying list, and is patched into all of the area's tab buttons in place. Tabs share the full width on phones for a comfortable tap target and size to
  their own label from `--bp-md`, because two tabs stretched across the wide content column would
  read as banners rather than navigation. A primary action belongs in the first relevant card
  header when that card exists (for example „Ergebnis eintragen“ beside „Rangliste & Spielzeit“),
  so it does not insert a detached row between the area tabs and the content surface.
  Re-rendering the same tab reuses its existing `.section-view` element instead of rebuilding the
  shell, so a sub-view that reads its own previous DOM before redrawing (the Packliste's add-item
  draft and focus, the same survives-its-own-rerender pattern the Checkliste's To-Do form uses)
  keeps working across a background refresh triggered from outside that tab.
## Benachrichtigungszentrum

- **Notification center** — `.notification-highlight` exposes the newest active unread entry as a
  brand-gradient direct link below the topbar and follows its domain/expiry lifecycle;
  `.notification-center` with `.notification-center-panel`, `.notification-center-toolbar` and
  `.notification-center-entry` keeps the full personal history plus single/bulk read/remove state;
  unread entries use the accent edge and elevated background without an additional „Neu“ badge;
  obsolete entries (their underlying workflow resolved, or their own expiry passed) show a quiet
  `Obsolet`/`Abgelaufen` badge and never count as unread. The sticky footer holds two bulk actions
  in equal columns, growing to three equal columns only while at least one obsolete entry is
  present, which adds a targeted „Obsolete aufräumen“ action ahead of the other two.
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
  plain title for an event that list no longer holds.
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
  A foreign profile's detail dialog leads with identity (avatar, Gamertag, real name); the complete
  „Bock & Skill“ rating list across every game sits inside one initially collapsed
  `.collapsible-section` carrying the total game count, so a roster of many games does not force a
  long scroll just to see who someone is.
  Player creation stays in the authenticated Admin workflow. The desktop live board keeps exactly
  two equal-width cards per row; an odd final player does not stretch.
  The self-service profile uses the shared
  grouped-page hierarchy for profile data, Agent setup, Push, visible monitors and personal stats.
  Agent setup is split into three stable nested cards for choosing tracking, downloading and
  installing; tracking pause belongs to the first step beside foreground-activity tracking, and
  both explanations live in contextual tooltips beside their checkboxes. The first step's own title
  carries a third tooltip covering the feature as a whole — what the agent reads on the PC, what
  reaches the server and what it is used for — so the naming („Tracking“) never stands without
  that scope. Live status, playtime and derived evaluations apply only to the account's currently
  selected, running event with accepted participation, enabled tracking and valid event consent;
  without that context, an unpaused agent still reports matched game names for admin diagnostics.
  The event tracking tooltip and start confirmation explain the same prerequisites.
  The profile header owns
  its spacing to the first group. The unlabeled profile image, Farbe, Gamertag and optional name form one row from
  `--bp-md`; the three controls align their own centers to the image while their labels sit above.
  Phones wrap the two text fields below the visual controls. The shared save action stays
  below that row. The foreground option uses the concise label „Erweitertes Tracking“. Push uses the same checkbox language with its
  explanation in a tooltip instead of an action button and omits a redundant off-state sentence.
  Visible-monitor choices form exactly two columns from `--bp-md`, with phones kept to one column.
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

- **Grouped page sections** — `.grouped-page-sections` stacks the page's major areas with the
  shared vertical rhythm. Every `.grouped-page-section` is a full-width `.card`; its visible
  heading lives inside the surface through `.grouped-page-section-title`, while filters and
  subordinate rows remain part of that same group. This is the default hierarchy for overview
  pages with several related datasets instead of headings that float between unrelated cards.
  Nested `.card` surfaces use the secondary elevated background so their hierarchy remains visible.
  `.two-column-card-grid` keeps repeated cards in one column on phones and exactly two columns from
  `--bp-md`; a lone or final odd card spans the full row instead of leaving an accidental hole.
  `.adaptive-dashboard-columns` contains two semantic `.adaptive-dashboard-column` reading groups
  for views such as Profile. They stack in DOM/focus order on compact layouts and flow independently
  when Desktop is selected at `--bp-xl`; never recreate the former single grid where a tall card in
  one column delayed the next card in the other. Home and Admin instead use explicit priority rows
  whose repeated participant/user collections become three columns only in Desktop mode.
  The LAN „Mehr“ hub holds Mein Profil, Admin, Arcade, Durchsage, Jam and Orga. For a general event,
    it replaces the Orga wrapper with direct entries for Events and Essen; An & Abreise, Packliste,
    To-Do and Umfragen already occupy the bottom nav. Mein Profil remains here as the compact/mobile
    path. From `--bp-xl`, selecting Desktop replaces the bottom bar and „Mehr“ detour visually with
    a grouped direct rail: Home; LAN; Orga; Sonstiges; plus the bottom utilities Feedback,
    role-gated Admin and Mein Profil. The active event feature snapshot removes unavailable entries
    and empty groups. Profile and Feedback are not duplicated in the desktop top ribbon; the ribbon
    contains only global tools. The account-scoped Automatic/Desktop/Laptop choice lives in Mein
    Profil so it remains reachable in every shell. Essen is listed in „Mehr“ only for
    general events; LAN events retain its
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
  trailing action, while Orga alone uses the reserved second row for its tabs and may therefore start
  lower.
## Hall of Fame, Info und Feedback

- **Hall of Fame and Info** — Hall-of-Fame all-time rankings use the shared two-column leaderboard
  grid. „Nach LAN“ uses one directly labeled event dropdown and shows every overall placement for
  the selected LAN, followed by tournament winners in the same leaderboard-row structure. Blue and
  pink accent rails distinguish the two result groups; tournament game names have no decorative
  game symbols. Admin fixtures cover twelve years with full standings and three tournament winners per LAN so dense
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
  of four distinct sentiments — Positiv, Negativ, Problem, Idee — through the shared
  `.selection-toolbar` toggle rather than a free-text category, plus a message field. Admin's
  Feedback section lists open submissions first and orders each state newest first. It filters them
  by the same four sentiments plus „Alle“ through the shared `.chip`/`.chip.is-active` pattern
  (mirroring Spiele's genre chips and
  Orga's To-Do Art filter). Open entries expose the compact primary action „Erledigt“ through
  `.btn.btn-sm.btn-primary`. Completed entries move into a separate, initially collapsed
  „Erledigt“ section whose open state survives live re-renders; their secondary `.btn.btn-sm`
  action „Wieder öffnen“ moves them back without deleting the original message or its captured
  context.
## Mein Profil, Auswertung und Home

- **Profile** — The profile row uses the original compact square color preview. Activating it opens
  a centered Respawn modal instead of the browser's native color dialog. The modal combines a
  keyboard-, pointer- and touch-operable hue/saturation wheel with a live preview, an editable and
  copyable `#RRGGBB` field, and explicit cancel/apply actions; it has no competing preset palette.
  Invalid hex input is visibly rejected and cannot be applied or copied. The chosen value remains a draft until the profile's
  main save action persists it.
  A leading „Einladungen“ section (present only while pending event invitations exist) shows the
  same invitation cards Orga's Events tab used to render inline — cost/deadline disclosure plus
  Annehmen/Ablehnen — via events.js's shared `renderInvitationCard`. Acceptance replaces the card
  with „Event öffnen“; the invitation becomes read notification history and the action switches the
  active event. Security, Agent, notifications and visible monitors are clearly named collapsible
  groups below the always-visible identity editor. They start expanded; a user's manual collapse
  survives same-view re-renders. In Desktop mode, identity/password/notifications form the account
  column while ratings/visible monitors/statistics form the LAN-profile column. Pending invitations
  remain above both columns; the three-step Agent setup remains full width below them. The account
  column also contains the three-way view preference; changing it updates the shell without losing
  the current profile state.
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
  up to three tasks assigned to the signed-in identity, ordered by due date, or — while none are
  assigned yet — a single row nudging toward the shared pool's still-open To-Dos; with neither, the
  tile stays hidden rather than offering an empty link into the full list. Every current
  item pairs its full-row navigation action with a
  separate icon action that hides only that live occurrence for the signed-in identity and active
  event on the current device; a new vote round, order, tournament or lobby remains visible again.
  Tappable current items, the personal status and player entries remain nested cards on the
  secondary elevated background; „Gerade aktiv“ is a subsection of
  „Live-Status“ rather than a competing page-level group. A pending event invitation appears here as
  a plain linking nudge into „Mein Profil“ (see aktuellStatus.js); the full card with
  Annehmen/Ablehnen lives only in Profile, not in this list. Main groups stay in one continuous column
  at phone and laptop widths while their existing internal grids remain responsive. In Desktop mode,
  „Meine To-Dos“ and „Aktuell“ share the first priority row, followed by a three-column Live-Status,
  the full-width seating plan and a three-column top-six ranking. If only one priority card exists it
  spans the row. A general event
  replaces the LAN-only live and ranking groups with a leading event overview containing its type,
  period, optional location/note, participant count and contribution. It has no „Organisation“
  shortcut group; planning workflows remain reachable through navigation. Seating is LAN-only,
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
