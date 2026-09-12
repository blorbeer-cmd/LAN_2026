# Produktregeln: Orga und Events

Diese Datei enthält die aus dem Designkern verschobenen Regeln zu Sitzstatus, Bestellungen, Orga-Abläufen, Events und An- beziehungsweise Abreise.

## Sitzstatus

- **Seating status** — `.seating-status-indicator` sits directly after the gamer name and mirrors
  the shared live state as green „Spielt“, blue „Online“, yellow „Pause“ or red „Offline“. Its German title and
  accessible label preserve the meaning beyond color. Playing, online and pause indicators pulse gently,
  while offline stays static; the global reduced-motion rule disables that motion when requested.
  Every `.seating-seat` uses the same width and height on all four table sides, so vertical sides
  no longer stretch into wide rows. Phones switch all four sides to one shared compact size and
  keep exceptionally narrow layouts locally scrollable instead of widening the page.

## Durchsagen, Bestellungen und Orga

- **Broadcasts** — „Neue Durchsage“ and the recent history are separate grouped sections. Delivery
  channels live in the shared contextual tooltip directly beside „Neue Durchsage“ instead of a
  persistent explanation below the form. Recent broadcasts live in one standard, initially
  collapsed „Historie“ section whose open state survives live re-renders; its entries use the
  responsive two-column row grid.
- **Food orders** — Open and historical orders use one full-width nested card per row. Consecutive
  open cards alternate blue and pink accent rails; orderer groups and position rows use no decorative
  order, timer or link symbols. A send time is shown as `20.08. 19:30 Uhr`; without one the detail
  line reads `Kein Zeitpunkt festgelegt`. The view keeps the existing free-text description suggestions,
  quantity field, optional unit price with euro suffix, consolidated list and lifecycle actions.

  Payment is a per-person handoff, never a per-position action. Each orderer group shows the
  quantity-weighted meta line (`<n> Positionen`, plus `Preis fehlt` when necessary), the complete
  tip-inclusive person sum with a small `inkl. x % Trinkgeld` line when a tip is set, a copy action, a PayPal action when the order has a link, and one two-state
  paid marker. `Bezahlt?` uses a dashed circle; `Bezahlt` uses a green check and names the confirmer.
  Its fixed-width slot follows directly to the right of the PayPal action in the group action
  cluster, so label, position and total changes do not move it.
  The marker is derived from the group's items, is available to every authenticated member, and is
  disabled only after finalization. Both marking and reversing happen directly without a confirmation;
  the paid marker's tooltip names existing confirmers. A group delete is available only for the current
  member's open, entirely unpaid group and confirms the complete position list. When a group is paid,
  every one of its position descriptions and amounts is struck through; reversing removes that treatment.
  Finalization itself is not permanent: the creator/an admin can reopen a finalized ("Geschlossen") order
  back to the closed/"Abgeschickt" state through the same `Wieder öffnen` action shown for a merely closed
  order, which restores paid marking and metadata edits (items stay frozen until a further reopen).

  The PayPal button is the only payment handoff. It opens a blank tab synchronously, clears its opener,
  refreshes the order immediately before navigation, aborts when the order or any group item vanished,
  was paid elsewhere, lost its link, or has an incomplete price, and then navigates to the exact
  stored URL, appending the amount only for a bare `paypal.me` recipient link. A `Bezahlt?` dialog
  opens immediately after navigation, explains whether the amount was prefilled, lists every displayed
  position amount, and offers copy actions for both the total and stored PayPal address; only the
  affirmative answer marks all group items paid. The local `paypal` icon is the filled brand path in
  `icons.js`; other icons remain line icons.

  Below `--bp-md` an orderer group becomes two rows instead of one: the person, then their sum with
  its tip note beside it at the same left edge as the name, sharing that row with the action
  cluster. The four fixed-width controls need 240px on one line, which no supported phone width
  leaves next to a name, so the name keeps a row of its own; where the remaining row cannot hold
  the sum and all four controls either, wrapping moves the cluster down whole rather than dropping
  a single control onto a ragged extra line. The cluster fills the width its row leaves it, which
  is what keeps the marker's slot independent of its label. A group holding a single position drops
  its sum entirely there: that position already prints the identical tip-inclusive total one row
  below, so the sum only cost a row. A collapsed group keeps its sum, because its position rows are
  hidden and the sum is then the only amount on screen. Position rows follow the same split: the
  description takes the first row, amount and actions share the second, so every position's
  trailing action ends on the group action row's right edge. The order's detail links stack
  full-width there for the same reason — wrapped, `Bestellübersicht`'s `margin-left:auto` left it
  alone against the right edge.

  Position rows contain only quantity × description, amount, copy and delete. The displayed amount
  includes quantity and tip; copy uses exactly that display string. There is no position-level paid
  marker, selection state or row divider; their strike-through is derived from the person-level paid
  state. Own open positions can be deleted after the existing confirmation; paid positions disable
  deletion. Foreign and unavailable actions keep their reserved spacer so columns stay aligned. The
  order summary counts quantity-weighted positions,
  people, fully paid people and the open sum of people not fully confirmed. Missing prices show the
  actual priced subtotal with `Preise unvollständig`; the total is labeled `(unvollständig)`.

  The detail-links row always contains `Bestellübersicht`, visible to everyone, with `margin-left:auto`.
  The list deliberately contains no names or paid state: it consolidates normalized descriptions by
  exact unit price and shows quantity, unit price, line total, subtotal and tip-inclusive total.
  The order card puts title/status, creator/time metadata, info, summary, toolbar, groups, total,
  add form and lifecycle actions in that order. The toolbar contains only
  `Alle ausklappen`/`Alle einklappen`, aligned left. When more than one order is open, each card
  starts collapsed; a sibling `aria-expanded` button controls its body, and a search/push target
  expands exactly that card. A single open order has no card-collapse chrome. The same rule applies
  independently inside Historie: once it holds more than one closed/finalized order, each of its
  cards gets the identical collapsible header/chevron and starts collapsed too, while a single
  history entry stays chrome-free. A target for a sent order opens the history section and expands
  that specific card within it (when Historie holds more than one entry) instead of only the section
  itself. Both expanded-state sets live in module state and survive live re-renders.
  The add action is a normal `.btn` spanning the last grid columns and stretching to field height.

  Two hours after an order is sent, unpaid active members become eligible for a direct payment
  reminder, repeated at most once per rolling two-hour window. Home's `Aktuell` list enriches the
  existing order row instead of adding a duplicate. The
  reminder uses the same order deep link and a durable per-player/event send timestamp independent of
  the bounded push history.
- **Orga** — the area that holds the LAN's preparation, reached through „Mehr“. Its five area tabs
  are sorted alphabetically by their German label: „Umfragen“, „An- & Abreise“, „Events“, „Packliste“ and
  „To-Do“ (the last two formerly the separate „Checkliste“ and „An- & Abreise“ areas;
  docs/KONZEPT-PACKLISTE-TICKETS.md Abschnitt 9 records the earlier „Packliste“→„Checkliste“
  rename — „Events“ is the former standalone „Einstellungen“ view, moved here because it is setup
  work like the rest of Orga rather than a personal preference screen; there is no longer a topbar
  settings icon). TV-Kiosk is deliberately not an Orga tab — it lives only behind Admin's
  „Kioskverwaltung“ tool card (see [„Admin tools“](navigation-and-account-rules.md#profile-und-admin)) since opening the shared-screen dashboard is an
  admin task, not something every member needs from Orga. „Mehr“ opens Orga on its first tab,
  „Umfragen“, like every other area (`sectionEntryView()` in `sectionNav.js`), so the tab row's
  top-left tab is the one actually selected on arrival; the already persisted push url `/#checklist`
  is unaffected and still lands directly on To-Do. That tab label carries
  the live count of the current identity's own open+taken items. The checklist's former in-view
  toggle is gone — its two halves are area tabs now, so no tab row nests inside another.
  In a general event the same routes keep their data and deep links but lose the Orga wrapper:
  An- & Abreise, Packliste and To-Do are direct bottom-nav pages, while Events is a direct entry
  under „Mehr“. Each page owns its concise title and shows no Orga tab row. Umfragen occupies
  the fifth bottom-nav slot and opens the shared event poll view directly.
  The personal list is unchanged: a compact checkbox row per item (Grundstock plus freely added/removable
  custom entries) with a checked item shown via muted, struck-through text instead of a separate
  badge, followed by the plain add-item field/button row.
  Any active member — not only Owner/Admin — can create a To-Do of either Art (Aufgabe/
  Mitbring-Anfrage) through one unified „To-Do erstellen“ dialog: a `.selection-toolbar` Art toggle,
  Titel/Beschreibung, a second `.selection-toolbar` for „Zuweisen an“ (Niemand/Ich/Personen wählen —
  the last reveals the existing player-selection grid plus „Alle auswählen“/„Alle abwählen“), and an
  optional „Fällig bis“ date using `dateTimeFieldHtml`'s `dateOnly` mode (no time-of-day picker, since
  none is meaningful here). Switching Art or Zuweisen-an mid-form preserves already-typed field values
  across the internal re-render, the same survives-its-own-rerender pattern the add-item field uses.
  „Mir zugewiesen“ is a dedicated first subsection listing the current identity's own open+taken
  To-Dos sorted by due date (undated ones last); an overdue card gets the `checklist-task-overdue`
  border/background treatment and every card with a due date carries a `.badge-overdue`/
  `.badge-due-soon`/`.badge-neutral` pill (never color alone — the badge text itself says „Überfällig“/
  „Heute fällig“/„Morgen fällig“/„Fällig in N Tagen“/a plain date). „Offen“ (the shared pool) gets
  `.chip` filter toggles for Art (Alle/Aufgaben/Mitbring-Anfragen) plus a „Von mir erstellt“ toggle,
  each marked `.chip.is-active` when selected; the pool otherwise still uses one bare `.badge` to
  distinguish the two types and the same nested-card layout as before. „Übernehmen“ replaces the claim
  action once someone else already committed to it, and the creator sees „Zurückziehen“ on their own
  open entry instead. To-Dos already taken by someone else move into the „Unterwegs“ subsection with
  the current assignee's avatar/name and due badge; taken by the current identity, they show in „Mir
  zugewiesen“ with „Freigeben“/„Erledigt“ actions instead. Completed To-Dos live in one standard,
  initially collapsed „Historie“ section whose open state survives live re-renders, same as Food
  orders.
  The „Umfragen“ tab is the event-centric planning surface for free questions such as dates,
  locations, duration or budget. It always uses the active event from the existing top-right
  workspace switcher, including the permanently open „Allgemein“ base event: neither the tab nor
  its create dialog contains a second event picker. Visibility, creation and
  voting all require confirmed participation in that event; being Owner/Admin or merely invited
  never bypasses this boundary. Every confirmed participant may start a poll, while the creator of
  that poll manages its deadline, reminders and rounds. The create dialog uses labelled fields,
  repeatable free-text option rows and four explicit response modes: per-option „Passt / Wenn nötig
  / Passt nicht / Offen“, exactly one choice, multiple choices with an optional maximum, or a
  per-option rating from 1 to 5. It never exposes
  a participant picker because the accepted event roster is the single source of truth.
  The tab adds no own page heading or explanatory subtitle below the Orga tabs because the active
  event is already visible in the top-right workspace switcher. Its compact „Umfrage starten“
  action has no decorative plus sign. The create dialog uses ordinary global text fields, one native
  select for the four response modes (per-option feasibility, single choice, multiple choice and
  per-option 1–5 rating), and contextual info beside response mode and deadline. Every free option
  may additionally carry a short note and a validated HTTP-/HTTPS-link. A poll can be marked
  anonymous in the same dialog; this permanently suppresses voter-to-answer mappings.
  Each poll is one collapsible card. Its current round and response progress stay together; the
  creator's compact „Bearbeiten“, „Erinnerung versenden (N)“, „Beenden“ and „Löschen“
  actions remain in the card header while collapsed. They share one „Aktion“ menu; opening one
  poll's menu closes every other poll menu, clicking outside or pressing Escape closes it, and its
  card is raised above later siblings while the menu is open. Earlier rounds live in a nested,
  initially collapsed history and show their best result, start time, creator and end time before
  the detailed options. „Offen“ is both an explicit way to clear a per-option feasibility rating and
  the resulting incomplete-response count. Repeated reminders reuse one stable notification-center
  entry per poll and recipient, moving it to the top; automatic sends run 48 hours and 2 hours before
  the deadline. While a round is open, its creator can edit title, description, deadline, option
  notes and links and append further options; existing options cannot be removed from that dialog.
  Adding options informs everyone who had already completed the round and makes those responses
  incomplete until the added options have been answered. Option rows keep the title with a note
  info-tooltip and an icon-only link immediately beside it, counts and compact response controls
  within a shallow two-row layout. Single- and multiple-choice controls say „Wählen“; their
  „Meiste Stimmen“ badge stays on the same title line as the option name. An optional
  response-details disclosure is rendered only after a non-anonymous round has
  ended; the server withholds those identities while a poll is open and for anonymous polls at every
  status. Avatar, name and response timestamp share one vertically aligned voter row. Progress and
  deadline appear once in the card header, not again above the option rows. A round without a
  deadline shows „Keine Frist“ in its header and round history; automatic deadline reminders apply
  only to dated rounds. Poll re-renders preserve
  the visible card's scroll anchor. Ending a round immediately turns
  its counts into the read-only result overview; there is no separate result-recording action. Event
  cards do not embed or link to poll controls. A poll result changes no event field, schedule revision
  or participation state.
  A future explicit „apply to event“ interaction is outside the current UI.
  The „Events“ tab is reachable by every member, not only by owner/admin, because answering an
  invitation is a personal action. What it shows depends on the role: owner/admin receive the full
  management surface — anlegen/bearbeiten, Tracking starten/stoppen (the running/stopping button
  carries a tooltip naming the collected data and its purpose; its confirmation repeats the same
  scope sentence), Teilnehmende einladen/entfernen
  and the PDF „Andenken“-Export — while a member gets read-only cards for the events they take
  part in, without the „Event anlegen“ action or administrative invitation/decline controls; the card
  includes the event-type badge, event-status badge plus the count and names of accepted
  participants. Cards sort from the earliest start date to the latest; events without a fixed date
  follow the scheduled events. A finished event moves out of the active list into the tab's own
  „Historie“ (the same collapsible-section pattern as Food orders): it starts collapsed and
  preserves its open state across live re-renders. Pending invitations for the current identity are
  deliberately absent from this tab — a teaser sitting directly above the Events cards made it too
  easy to miss and cluttered the tab with the cards immediately following it. Instead, an
  invitation surfaces as a personal Home „Aktuell“ nudge (see [„Home overview“](navigation-and-account-rules.md#mein-profil-auswertung-und-home)) that links into „Mein
  Profil“, and Profile's own leading „Einladungen“ section is where it is actually answered
  (`renderInvitationCard`/`pendingEventInvitations`/`wirePendingInvitationActions` in `events.js`,
  reused by `profile.js` so the card markup and accept/decline wiring exist exactly once).
  An *answered* participation is different: it stays on this tab, because this is where the member
  already looks at the events they are part of. Every card variant therefore carries the account's
  own answer through `ownParticipationAction`: „Teilnahme absagen“ while the server reports
  `myParticipation.canDecline`, „Doch zusagen“ while it reports `canAccept`, and otherwise the
  reason in plain words (`lockReason`: recorded payment, running, ended or cancelled event) rather
  than a control that silently disappears. Member and management cards both keep a dedicated
  personal-participation footer. A management card marks its own decline with „Du: Abgesagt“ in
  its header — organizing an event is not the same as attending it, and administrative removal
  in the participant list only removes a roster row, which is a
  different act from answering for oneself. A still-open invitation stays out of all of this; it is
  answered on its invitation card in „Mein Profil“.
  Declining is not leaving: for a member the event moves into this tab's own „Abgesagt“
  section — the same collapsible-section pattern as „Historie“, likewise collapsed by default and
  preserving its open state — where it stays as a teaser card with „Doch zusagen“
  (`renderDeclinedEventCard`). An owner/admin keeps seeing it as a management card instead, since
  that list already holds every event of the group, and it is therefore never listed twice. Only an
  organizer withdrawing the invitation removes the event from someone's app entirely, and that
  removal notifies them unless they had declined themselves. Event
  cards stay in one vertical column at
  phone and laptop widths so payment and participant controls keep enough room. Their card hierarchy
  deliberately mirrors Food orders: alternating accent rails and a concise title/status header lead
  into one shared `.food-order-details` information box, followed by the separately collapsible
  participant list. Date, location, note and payment information therefore never form competing
  sibling boxes; each header also shows the recorded creator, and adds the date range while the card is
  collapsed — an expanded card leaves the period to the information box below rather than printing the
  identical range twice, and a lone uncollapsible card therefore shows the creator only. The collapse
  toggle repeats that header text in its accessible name instead of pointing an `aria-describedby` back
  into itself. Missing creators use „Unbekannt“, undated events keep „Termin wird noch abgestimmt“. Owner/admin cards expose
  „Bearbeiten“, state-dependent Tracking/Beenden/Wieder-starten and the LAN PDF export in the shared
  „Aktion“ menu beside the header badges; member Event cards have no such menu. Cards in lists with
  multiple events start collapsed, keep their disclosure state through refreshes and preserve keyboard
  focus when toggled. A single event stays expanded without collapse controls, and location links
  are clickable without a separate copy action when an event stores a web URL; plain locations remain
  text. A current event with a complete start/end period offers „Google Kalender“, „Outlook“ and
  „Kalenderdatei“ directly inside that same information box; the first two open a prefilled web event,
  while the RFC-5545 `.ics` download covers native and other compatible calendar apps. An accepted
  participant explicitly confirms the handoff below those actions because external providers expose no
  reliable import callback. The confirmation becomes a compact „Im Kalender eingetragen“ state and is
  bound to the event's current start/end period, so moving the date asks for confirmation again while
  the participant's acceptance itself deliberately stays valid. Pending invitations, ended events and
  incomplete periods omit the action group. Two-hour and weekly calendar nudges stop after
  confirmation; general one-week and one-day event reminders do not, and a moved period announces
  itself again on its own approach. The
  account `$t3vYb0y` gets the deliberate Stefan gag: its confirmation opens one additional themed
  safety question, and one week after confirmation it receives one final direct calendar check while
  the event is still upcoming.
  Directly below the calendar group, the same information box carries the second deliberate gag of
  this area: „Paralleltermin?“ plus „Ausrede generieren“ opens the Ausreden-Generator
  (`eventExcuses.js`, `renderEventExcuseActions`/`wireEventExcuseActions` in `events.js`). It writes
  an excuse for whatever *other* appointment collides with the event, so no entry ever names the
  event itself — the text is meant to be sent to the organizer of the competing date. The action
  appears on management cards, member cards and pending invitations alike, because deciding against
  a parallel obligation is a personal act, and disappears once an event has ended. The dialog is a
  shared `openModal()` instance with the standard `.chip`/`.chip.is-active` category filter (Alle
  plus eight categories, the same filter pattern as Orga's To-Do Art chips), one nested result
  surface with an `aria-live="polite"` region so „Neue Ausrede“ is announced without rebuilding the
  dialog, and the two equal-width actions „Neue Ausrede“ and „Kopieren“. It carries no explanatory
  copy above the filter: the title, the chips and the excuse itself already say what the dialog is,
  and a sentence repeating the event name and a pool count only pushed the actual result down.
  Every excuse is tagged with
  the absence lengths it fits: a single evening, a two-to-three-day weekend or a longer trip, so a
  three-day LAN never gets an excuse written for one afternoon. Every category stays usable at every
  length — the pool is kept wide enough that no category collapses to a handful of entries for long
  events. An event whose date is still being
  polled receives the date-free subset instead, because its texts cannot fill a period honestly. The
  „Glaubwürdigkeit N/5“ badge is part of the joke and derives from the rendered text itself — length
  plus concrete numbers — since detail is what the whole feature trades on. Event creation and editing may
  add one optional per-person cost plus the same PayPal input as food orders: either an e-mail address
  or a complete HTTPS address on `paypal.me`/`paypal.com`. Cost and PayPal controls reuse the food-order price suffix
  and contextual label layout so both fields stay aligned. Invitation cards disclose that cost
  and its optional deadline before acceptance, without offering payment actions yet. Accepted
  non-creators see only their own contribution and `Noch zu bezahlen`/`Bezahlt` state, the confirmer
  and timestamp of their own payment, plus a personal toggle for recording or correcting it; foreign
  payment states and aggregates are absent from both UI and API payload. A managing non-creator who
  lacks payment-management rights receives only the boolean `paymentLocked` removal guard on roster
  rows, without amount, actor or timestamp, so the blocked action has an explicit reason; this is
  the sole administrative exception to the foreign-payment privacy rule. The visible full-width
  PayPal action says `Bezahlen`. The handoff refreshes the event before opening PayPal,
  prefills the EUR amount for PayPal.me, attempts to copy an e-mail recipient for the generic PayPal
  flow and keeps that recipient visible in the confirmation if clipboard access is unavailable. It
  asks „Bezahlt?“ afterwards; only an affirmative answer records the payment. The recorded event
  creator instead receives the aggregate overview and the same `Offen`/`Bezahlt` toggle used by food
  orders on every accepted participant row. There is no bulk-payment action. The edit form can also
  record the accommodation's total invoice separately from the fixed contribution per person. The
  creator's payment box compares snapshotted received contributions with that invoice. Confirmed
  payments remain in the received total after a decline or account deactivation; a paid roster row
  cannot be removed until its payment is explicitly reset. If the creator account becomes inactive
  or is deleted, the group owner becomes the payment manager. The box shows the
  current surplus/deficit, the projected result after every accepted person pays and the rounded
  accommodation price per current acceptance; pending and declined invitations never enter that
  per-head calculation. Payment controls keep the reset action visible for an already recorded
  payment even if the current contribution was subsequently cleared, so roster and account-removal
  guards never create a dead end. The card-level list
  includes every invited account and labels each row as `Zugesagt`, `Einladung offen` or
  `Abgelehnt`; its summary separates accepted and still-open invitation counts. Member cards remain
  accepted-only and expose neither pending/declined identities nor that management status. Participant lists use
  the shared collapsible-section behavior plus Food orders' leading chevron/name/meta header pattern,
  start closed and preserve their open state across live re-renders. Their people remain one full-width
  row per line at every breakpoint so payment proof and the creator's toggle have predictable room;
  owner/admin cards integrate Einladen, Erneut einladen and Entfernen directly in this list.
  Eligible people without an invitation follow existing roster entries with an Einladen action.
  Ended events omit those uninvited rows. Creating an event opens its card and roster directly;
  there is no separate participant-management dialog. State-specific blockers remain explicit: an ended event shows once that
  new invitations are unavailable, and a paid row associates its removal action with the instruction
  to reset the payment first.
  An optional date-only payment deadline starts reminders on that day; without one, contributions
  become eligible two hours after acceptance. Further reminders run at most once per rolling two-hour
  window, using durable reminder state independent of push history. TV-Kiosk (Admin's „Kioskverwaltung“
  card, not an Orga tab) stays one grouped section but lists one automatic account for every LAN
  event, including its stable `kiosk-<eventId>` username and a prefilled link to `/kiosk.html`.
  The section leads directly with the shared login password itself (configured or generated once
  on first use — see server/OPERATIONS.md) as one compact label/value/copy-icon row, so admins never
  need server/.env access just to read out a working kiosk login. It has no repeated explanation or
  unscoped login action above the event cards. Each event card provides one primary `Kiosk öffnen`
  action with its account already selected. The standalone page shows a centered
  account/password card until its event-scoped credential is established; this identity never
  becomes a player or a regular app session.

## An- und Abreise

- **Arrival carpools** — the „An- & Abreise“ tab of Orga. Anreise and Abreise remain separate
  full-width accented panels. Their
  carpool cards use two columns from `--bp-md`, but an odd final card deliberately keeps one-column
  width instead of spanning the row; phones stay single-column. Every card repeats Start and
  Ankunft vertically and proceeds directly into the passenger rows without a redundant
  „Mitfahrende“ caption. Below the current passengers, every available passenger seat has its own
  compact „Frei“ row with a direct „Mitfahren“ action for eligible players. The driver row uses the
  same right-hand action column for a neutral „Fahrer“ label. Occupied passenger rows and free rows
  without an available join action show the parallel neutral „Mitfahrer“ role. All member and free
  rows share one minimum height; the join action stays compact inside it. A driver's „Bearbeiten“
  action uses the primary button treatment next to the destructive delete action.
