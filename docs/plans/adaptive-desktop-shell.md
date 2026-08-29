# Adaptive desktop shell

## Decision

Respawn remains one responsive browser application. At the existing `--bp-xl` breakpoint (1280px)
people can choose **Automatic**, **Laptop** or **Desktop** in Mein Profil. Laptop keeps
the compact bottom bar, the narrower content column and the „Mehr“ hub even on a wide monitor;
Desktop exposes the same routes in a grouped left side rail and uses the additional content width.
Automatic is the default and follows the existing `--bp-xl` breakpoint. The choice is stored in the
browser under the verified account id, survives logout and reload, and cannot leak to another account
on a shared device. Below `--bp-xl` every preference renders the safe compact geometry; an explicit
Desktop choice applies again when the window is wide.

The rail has four scanning levels: Home; LAN (Match, Vote, Spiele); Orga (Events, Umfragen,
An- & Abreise, Packliste, To-Dos, Essen); and Sonstiges (Durchsage, Arcade, Jam). Feedback, the
role-gated Admin entry and Mein Profil form a stable utility block at the bottom. Empty or disabled
feature groups are filtered from the active event snapshot. Home and Admin are never duplicated.

The desktop grouping is a wider-screen information hierarchy, not a second route system. It keeps
deep links, browser history and role boundaries identical on every device. Child routes resolve to
their stable parent destination (for example Turnierdetail to Match and an active Arcade game to
Arcade). The active destination exposes `aria-current="page"`; route changes update the document
title and move focus to the rendered heading only when the initiating control disappears or browser
history causes the change. Persistent rail buttons retain focus. Mobile back controls leading to
„Mehr“ are hidden at desktop width because those destinations are already top-level there.

An event switch is one queued transition across event data, navigation, the current view and the
notification center. The visible switcher stays disabled through competing realtime refreshes and
is rebuilt as ready only after a current event-scoped snapshot has committed. This prevents a new
event label from appearing alongside content from the previously active event on slower clients.

## Adaptive pilot views

- **Home** places personal To-dos and „Aktuell“ side by side at the top. Live participants use three
  equal columns, followed by the full-width seating plan and a three-column compact ranking. A missing
  priority card spans the row instead of leaving an empty half.
- **Match** uses three equal participant columns in the wide Desktop composition. Search, selection,
  Captain Draft semantics and the compact fallback remain unchanged.
- **Admin** groups tools/readiness and account access/test data into two priority rows. User and agent
  collections use three equal columns below them, while every function and diagnostic remains present.
- **Profile** separates account settings (identity, password, notifications) from LAN-specific
  settings (ratings, visible monitors, statistics). Invitation handoffs remain first and the
  sequential three-step Agent setup remains full width. The account column owns the three-way view
  preference. All collapsible groups still start open.
- **Arcade** keeps the active game in the main column. „Spiel wechseln“, running games and statistics
  form the supporting column. Without an active game, the established full-width launcher remains.

Every priority row keeps DOM, keyboard and visual order aligned. At phone and laptop widths those
rows stack as one continuous flow. The wide content column grows to 1600px without counting the rail
twice in its centering calculation.

## Deliberate limits

- The rail does not duplicate Home, Admin, Feedback or Profile in multiple desktop locations. Info,
  search, event selection and notifications remain in the top ribbon because they operate across
  the current view rather than replacing it. The view preference belongs to Profile because the
  desktop rail itself is unavailable while Laptop is selected.
- Vote receives no new composition in this stage. Its full searchable catalog, existing filters and
  absence of a genre filter stay as most recently approved.
- Games is unchanged because the existing filters already solve list access and no new browser
  measurement justifies a second layout.
- No resizable panes, framework, new dependency or server-side preference schema is introduced.
  The layout choice is intentionally a small account-keyed browser preference.

## Verification contract

Browser regression coverage checks automatic breakpoint resolution, all three preferences,
account-keyed persistence across a real logout/login, group order, feature and role filters, utility
placement, exact active destination, onboarding spotlight targets, document titles, focus after
subpage navigation, the pilot compositions and the unchanged mobile fallback. Required frontend lint, build, token
checks, unit/integration tests and the full E2E suite remain mandatory before the draft pull request
is ready for review.
