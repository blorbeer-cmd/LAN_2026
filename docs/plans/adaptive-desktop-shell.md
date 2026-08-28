# Adaptive desktop shell

## Decision

Respawn remains one responsive browser application. At the existing `--bp-xl` breakpoint (1280px)
the compact bottom bar gives way to a grouped left side rail. Phone and laptop layouts retain their
six event-aware destinations and the „Mehr“ hub; desktop exposes the same routes directly.

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

## Adaptive pilot views

- **Home** places live or event overview content in the wider main column. To-dos, organisation and
  the compact ranking form the supporting column; the seating plan spans the full content width.
- **Admin** keeps frequent tools and account management in the main column. Readiness, optional test
  data and diagnostics form the supporting column. Every existing function and diagnostic remains.
- **Arcade** keeps the active game in the main column. „Spiel wechseln“, running games and statistics
  form the supporting column. Without an active game, the established full-width launcher remains.

The DOM order is unchanged and remains the reading, keyboard and narrow-screen order. CSS grid only
changes visual placement at `--bp-xl`, so mobile, laptop, reload and live rerender behavior continue
to use the existing implementation. Dense placement fills the main and supporting columns from the
same top edge when an optional preceding group is absent; the wide content column grows to 1600px
without counting the rail twice in its centering calculation.

## Deliberate limits

- The rail does not duplicate Home, Admin, Feedback or Profile in multiple desktop locations. Info,
  search, event selection and notifications remain in the top ribbon because they operate across
  the current view rather than replacing it.
- Vote and Profile receive no new composition in this stage. The full searchable Vote catalog and
  the initially expanded Profile groups stay as most recently approved.
- Games is unchanged because the existing filters already solve list access and no new browser
  measurement justifies a second layout.
- No resizable panes, framework, new dependency or persisted desktop preference is introduced.

## Verification contract

Browser regression coverage checks the rail/bar breakpoint, group order, feature and role filters,
utility placement, exact active destination, document titles, focus after subpage navigation, the
three pilot compositions and the unchanged mobile fallback. Required frontend lint, build, token
checks, unit/integration tests and the full E2E suite remain mandatory before the draft pull request
is ready for review.
