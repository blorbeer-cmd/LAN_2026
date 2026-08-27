# Adaptive desktop shell

## Decision

Respawn remains one responsive browser application. At the existing `--bp-xl` breakpoint (1280px)
the six event-aware primary destinations move from the bottom bar into a left side rail. The topbar,
route registry, permissions, event-specific navigation order and „Mehr“ hub remain shared with
phone and laptop layouts.

This is a presentation change, not a second desktop information architecture. It avoids duplicated
navigation state and keeps deep links, browser history and role boundaries identical on every
device. The rail reuses the current buttons, icons, labels and active-group calculation. The active
destination additionally exposes `aria-current="page"`; route changes update the document title and
move focus to the rendered heading only when the initiating control disappears or browser history
causes the change. Persistent rail buttons retain focus.

## Adaptive pilot views

- **Home** places live or event overview content in the wider main column. To-dos, organisation and
  the compact ranking form the supporting column; the seating plan spans the full content width.
- **Admin** keeps frequent tools and account management in the main column. Readiness, optional test
  data and diagnostics form the supporting column. Every existing function and diagnostic remains.
- **Arcade** keeps the active game in the main column. „Spiel wechseln“, running games and statistics
  form the supporting column. Without an active game, the established full-width launcher remains.

The DOM order is unchanged and remains the reading, keyboard and narrow-screen order. CSS grid only
changes visual placement at `--bp-xl`, so mobile, laptop, reload and live rerender behavior continue
to use the existing implementation.

## Deliberate limits

- The rail does not expand „Mehr“ into additional desktop-only destinations; that would make route
  discovery and permission behavior viewport-dependent.
- Vote and Profile receive no new composition in this stage. The full searchable Vote catalog and
  the initially expanded Profile groups stay as most recently approved.
- Games is unchanged because the existing filters already solve list access and no new browser
  measurement justifies a second layout.
- No resizable panes, framework, new dependency or persisted desktop preference is introduced.

## Verification contract

Browser regression coverage checks the rail/bar breakpoint, unchanged destination set,
`aria-current`, document titles, focus after subpage navigation, the three pilot compositions and a
mobile fallback. Required frontend lint, build, token checks, unit/integration tests and the full E2E
suite remain mandatory before the draft pull request is ready for review.
