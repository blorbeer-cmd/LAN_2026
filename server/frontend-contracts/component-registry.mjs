// Package 2 registry data only. No checks, fixtures, hooks or npm integration.
// Roles: standard-control (1), structural-target (2), composite-part (3), temporary-exception (4).

export const components = [
  {
    "id": "button",
    "role": "standard-control",
    "selector": ".btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Standard text button; meaning and width compose without changing its interior."
  },
  {
    "id": "button-meaning",
    "role": "standard-control",
    "selector": ".btn-primary, .btn-danger, .btn-ready",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Color and state only; inherit the selected geometry."
  },
  {
    "id": "button-width",
    "role": "standard-control",
    "selector": ".btn-block, .btn-equal",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Width only; inherit the selected geometry."
  },
  {
    "id": "button-small",
    "role": "standard-control",
    "selector": ".btn-sm",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Compact text at the same 32px minimum height."
  },
  {
    "id": "button-square",
    "role": "standard-control",
    "selector": ".btn-square",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Numeric poll scale: exactly 32 by 32px, including selected values."
  },
  {
    "id": "icon-button",
    "role": "standard-control",
    "selector": ".icon-btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "32px height and at least 44px width."
  },
  {
    "id": "native-fields",
    "role": "standard-control",
    "selector": "input[type='text'], input[type='password'], input[type='number'], input[type='url'], input[type='search'], input[type='datetime-local'], select, textarea",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "32px single-line fields; textarea rows/content may grow."
  },
  {
    "id": "selection-icons",
    "role": "standard-control",
    "selector": ".selection-toolbar-icon, .selection-toolbar-icon--clear, .selection-search-trigger, .selection-search-close",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Selection and search icons inherit icon-button geometry."
  },
  {
    "id": "selection-toolbar",
    "role": "composite-part",
    "selector": ".selection-toolbar, .selection-search",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Wrapping container preserves gap, whole controls and DOM order."
  },
  {
    "id": "info-trigger",
    "role": "standard-control",
    "selector": ".info-tooltip-trigger, .info-tooltip-trigger--warning",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Help and warning use the same 44 by 32px hit box."
  },
  {
    "id": "date-fields",
    "role": "standard-control",
    "selector": ".dt-date-input, .dt-time-input, .dt-month-select, .dt-year-select, .dt-calendar-btn, .dt-clear-btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "DateTime manual fields, native selects and adjacent calendar/clear actions."
  },
  {
    "id": "calendar-days",
    "role": "structural-target",
    "selector": ".dt-day, .dt-day-today, .dt-day-in-range, .dt-day-selected",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Permanent six-row calendar grid and its 44px day cells."
  },
  {
    "id": "number-stepper",
    "role": "composite-part",
    "selector": ".number-stepper, .number-stepper-btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Two supplementary half-buttons inside a 32px number field."
  },
  {
    "id": "search-select",
    "role": "standard-control",
    "selector": ".search-select-toggle",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Field-integrated 44 by 32px dropdown trigger."
  },
  {
    "id": "search-options",
    "role": "structural-target",
    "selector": ".search-select-option",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Permanent listbox option rows, at least 44px."
  },
  {
    "id": "profile-controls",
    "role": "standard-control",
    "selector": ".profile-color-trigger, .profile-color-picker-copy, .profile-color-picker-value, .profile-layout-option",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Profile controls use the standard field/button/icon variants."
  },
  {
    "id": "row-icons",
    "role": "standard-control",
    "selector": ".tournament-lobby-copy, .home-current-dismiss, .game-icon-btn, .notification-center-seen, .notification-center-remove, .notification-highlight-dismiss",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Copy, dismiss and detail actions retain their 44px icon slot."
  },
  {
    "id": "arrival-controls",
    "role": "standard-control",
    "selector": ".arrival-note-input, .arrivals-sort-button",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Native textarea rows and 32px sorting buttons."
  },
  {
    "id": "filter-chip",
    "role": "standard-control",
    "selector": ".chip",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Interactive filter chips use 32px; passive chip labels are outside this control variant."
  },
  {
    "id": "section-tab",
    "role": "standard-control",
    "selector": ".section-tab",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Navigation button composed with the base button and optional meaning modifier."
  },
  {
    "id": "poll-choice",
    "role": "standard-control",
    "selector": ".event-poll-choice-btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Compact choice text retains the standard minimum height."
  },
  {
    "id": "poll-disclosure",
    "role": "composite-part",
    "selector": ".event-poll-card-toggle",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Composite card header: title plus round/deadline metadata are a documented multiline state."
  },
  {
    "id": "data-row-action",
    "role": "composite-part",
    "selector": ".data-row-action",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Only the account-access row contains the 320px name/badge/action reflow query."
  },
  {
    "id": "admin-controls",
    "role": "standard-control",
    "selector": ".admin-role-select",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Role field; its container handles reflow without changing standard field height."
  },
  {
    "id": "vote-fields",
    "role": "standard-control",
    "selector": ".vote-info-input",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Textarea minimum; rows/content determine the multiline state."
  },
  {
    "id": "food-fields",
    "role": "standard-control",
    "selector": ".food-order-desc-field, .food-order-price-input, .food-order-quantity-input, .food-order-add-button",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Standard fields and add button retain their form-column placement."
  },
  {
    "id": "payment-controls",
    "role": "standard-control",
    "selector": ".payment-paid-marker, .food-order-paid-marker, .payment-paypal-button, .event-paypal-button, .food-order-group-copy, .food-order-group-pay, .food-order-group-remove",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "32px payment/copy actions; icon actions inherit the shared minimum width."
  },
  {
    "id": "food-action-slots",
    "role": "composite-part",
    "selector": ".food-order-item-action, .food-order-item-action-spacer, .food-order-item-copy, .food-order-item-remove",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Composite position row reserves matching 44 by 32px action and empty slots."
  },
  {
    "id": "food-disclosure",
    "role": "composite-part",
    "selector": ".food-order-card-header-toggle, .food-order-group-toggle, .event-participant-toggle",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Card/roster heading and person plus metadata form a composite, optionally multiline disclosure."
  },
  {
    "id": "result-fields",
    "role": "standard-control",
    "selector": ".bracket-score-input, .tournament-score-input",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "32px score fields reserve the existing internal stepper column."
  },
  {
    "id": "result-actions",
    "role": "composite-part",
    "selector": ".bracket-result-edit, .bracket-score-submit, .tournament-result-edit, .tournament-score-submit",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Actions embedded in the score/bracket grid retain its reserved gutter and slot geometry."
  },
  {
    "id": "bracket-row",
    "role": "composite-part",
    "selector": ".bracket-team-row, .is-tbd, .is-winner",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Each team is one half of the fixed composite bracket match; states own no separate height."
  },
  {
    "id": "rating-slider",
    "role": "composite-part",
    "selector": ".skill-row-slider, .skill-row-slider-unset, .preference-row-slider",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Existing slider track/thumb geometry is internal to the rating control."
  },
  {
    "id": "rating-suggestion",
    "role": "composite-part",
    "selector": ".skill-suggestion-chip, .skill-suggestion-chip-diverges",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Inline application shortcut belongs to the rating label, with its existing icon/value geometry."
  },
  {
    "id": "structural-cards",
    "role": "structural-target",
    "selector": ".card, .list-row, .more-card, .home-current-navigate, .notification-highlight-link, .tournament-list-card",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Whole navigation/result cards preserve their existing row or multiline card geometry."
  },
  {
    "id": "global-search-result",
    "role": "structural-target",
    "selector": ".global-search-result",
    "owner": "public/css/overlays.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Whole search-result row retains its icon, title and description geometry."
  },
  {
    "id": "player-card",
    "role": "structural-target",
    "selector": ".player-card, .team-player, .check-row",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Whole player/selection rows preserve avatar, metadata and existing row geometry."
  },
  {
    "id": "player-selection-actions",
    "role": "structural-target",
    "selector": ".draft-pool-player, .tournament-drag-player",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Whole roster cards for picking/reordering, not standalone text buttons."
  },
  {
    "id": "structural-disclosure",
    "role": "structural-target",
    "selector": ".collapsible-section-header, .desktop-nav-btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Permanent disclosure headers and desktop rail rows retain their 44px minimum."
  },
  {
    "id": "row-layout",
    "role": "composite-part",
    "selector": ".row",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Layout attachment; the semantic control variant still owns its interior."
  },
  {
    "id": "selection-state",
    "role": "composite-part",
    "selector": ".is-active, .is-selected",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Context-owned selection markers; no standalone control geometry."
  },
  {
    "id": "payment-state",
    "role": "composite-part",
    "selector": ".is-paid",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Payment state marker inherits its host control geometry."
  },
  {
    "id": "arcade-segment",
    "role": "composite-part",
    "selector": ".arcade-mode-toggle, .arcade-mode-toggle-btn, .arcade-lobby-create-row",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Package-1 segment/pill and creation-row contract remains 32px; S stays 188px."
  },
  {
    "id": "arcade-mute",
    "role": "standard-control",
    "selector": ".arcade-mute-btn",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "44 by 32px mute action beside standard toolbar text buttons."
  },
  {
    "id": "arcade-tile",
    "role": "structural-target",
    "selector": ".arcade-tile, .is-soon",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Whole game-selection tile retains its name, status and card geometry."
  },
  {
    "id": "battleship-grid",
    "role": "structural-target",
    "selector": ".battleship-cell, .is-ship, .is-hit, .is-miss",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Permanent 44px game-board cells; ship and hit states do not change geometry."
  },
  {
    "id": "battleship-ship-display",
    "role": "structural-target",
    "selector": ".battleship-ship-segment, .is-ship-horizontal, .is-ship-vertical, .is-ship-start, .is-ship-end, .has-next-segment",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Ship decoration and orientation markers retain the structural board cell's hit box."
  },
  {
    "id": "challenge-targets",
    "role": "structural-target",
    "selector": ".challenge-rush-circle, .challenge-rush-big-button, .challenge-rush-choice, .challenge-rush-memory-cell",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Existing game reaction targets, choice tiles and memory cells keep their dedicated geometry."
  },
  {
    "id": "scribble-tools",
    "role": "composite-part",
    "selector": ".scribble-size-btn, .scribble-swatch, .scribble-swatch-active",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Internal brush-width and color samples in the drawing palette retain existing dimensions."
  },
  {
    "id": "scribble-word-choice",
    "role": "structural-target",
    "selector": ".scribble-word-choice-btn",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Dedicated word-selection game target retains its large type and padded choice surface."
  },
  {
    "id": "music-controls",
    "role": "standard-control",
    "selector": ".music-pairing-copy, .music-result-type-button",
    "owner": "public/css/overlays.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Pairing icon and result-type buttons inherit shared control geometry."
  }
];

export const permanentVariants = [
  {
    "id": "action-menu-trigger",
    "role": "standard-control",
    "selector": ".action-menu > summary.btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Bordered 32px trigger with chevron; short application-owned label."
  },
  {
    "id": "action-menu-entry",
    "role": "structural-target",
    "selector": ".action-menu-panel .btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent menu rows remain at least 44px high/wide and allow wrapping."
  },
  {
    "id": "topbar-icons",
    "role": "standard-control",
    "selector": ".topbar .icon-btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Topbar placement reserves 44px width; interior belongs to icon-button."
  },
  {
    "id": "selection-buttons",
    "role": "standard-control",
    "selector": ".selection-toolbar .btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Selection actions keep the base minimum, including the numeric square variant."
  },
  {
    "id": "poll-secondary",
    "role": "standard-control",
    "selector": ".event-poll-response-toolbar .btn:not(.btn-primary)",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Only the secondary background is contextual."
  },
  {
    "id": "poll-text-width",
    "role": "standard-control",
    "selector": ".event-poll-response-toolbar .btn:not(.btn-square)",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "44px text minimum excludes numeric squares in both selected and unselected states."
  },
  {
    "id": "poll-choice-text",
    "role": "standard-control",
    "selector": ".event-poll-choice-control .selection-toolbar .event-poll-choice-btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Compact text presentation keeps the standard 32px minimum."
  },
  {
    "id": "search-field",
    "role": "standard-control",
    "selector": ".search-select-control > input",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Native field reserves the integrated dropdown action width."
  },
  {
    "id": "selection-search-actions",
    "role": "standard-control",
    "selector": ".selection-search-trigger, .selection-search-close",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Matching search/open/close icon boxes."
  },
  {
    "id": "profile-preview",
    "role": "composite-part",
    "selector": ".profile-color-picker-preview",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Noninteractive preview exactly mirrors the adjacent 32px field height."
  },
  {
    "id": "tournament-label",
    "role": "composite-part",
    "selector": ".tournament-field-label",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Noninteractive field label occupies its sibling control line."
  },
  {
    "id": "arrival-sort-mobile",
    "role": "standard-control",
    "selector": ".arrivals-mobile-sort .arrivals-sort-button",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Bordered phone sorting controls retain the same single-line height."
  },
  {
    "id": "interactive-chip",
    "role": "standard-control",
    "selector": "button.chip",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "32px filter control; passive chips keep their existing label geometry."
  },
  {
    "id": "invite-link-controls",
    "role": "standard-control",
    "selector": ".invite-link-row > input, .invite-link-row .btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Short application-owned link actions remain nowrap; native field yields width."
  },
  {
    "id": "admin-test-fields",
    "role": "standard-control",
    "selector": ".admin-test-controls input, .admin-test-controls .btn",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Dense test-data form keeps its existing font/columns while every one-line control is 32px."
  },
  {
    "id": "data-row-name",
    "role": "composite-part",
    "selector": ".data-row-action > span > strong",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Only this name may visibly ellipsize; its full DOM/accessible text remains intact."
  },
  {
    "id": "data-row-action-label",
    "role": "standard-control",
    "selector": ".data-row-action > .btn",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Short application action stays nowrap; below 320px the whole action moves to row two."
  },
  {
    "id": "food-position-slots",
    "role": "composite-part",
    "selector": ".food-order-item-action, .food-order-item-action-spacer",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Matching action/spacer slots in a composite position row."
  },
  {
    "id": "food-payment-marker",
    "role": "standard-control",
    "selector": ".food-order-group-actions .payment-paid-marker",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Group paid marker keeps the same 32px action line."
  },
  {
    "id": "food-header",
    "role": "structural-target",
    "selector": ".food-order-card-header",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent 44px card header row, including its disclosure and other actions."
  },
  {
    "id": "vote-submitted-state",
    "role": "composite-part",
    "selector": ".vote-submitted-state",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Noninteractive confirmation is a status surface and may contain icon plus status copy."
  },
  {
    "id": "arcade-toolbar-buttons",
    "role": "standard-control",
    "selector": ".arcade-toolbar .btn",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Wrapped toolbar labels grow; no creation-row or segment geometry changes."
  },
  {
    "id": "challenge-test-disclosure",
    "role": "standard-control",
    "selector": ".challenge-rush-test-selector > summary",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "32px application-owned test-selector disclosure."
  },
  {
    "id": "topbar-title",
    "role": "structural-target",
    "selector": ".topbar-title",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent 44px brand/navigation row."
  },
  {
    "id": "desktop-navigation",
    "role": "structural-target",
    "selector": ":root[data-layout-mode='desktop'] .desktop-nav-btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent 44px desktop navigation rail rows."
  },
  {
    "id": "page-heading",
    "role": "structural-target",
    "selector": ".view-container > .view-title, .page-title-row",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent page-header alignment row."
  },
  {
    "id": "subpage-heading",
    "role": "structural-target",
    "selector": ".more-subpage-title-row",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent compact page-header alignment row."
  },
  {
    "id": "tabbed-subpage-heading",
    "role": "structural-target",
    "selector": ".more-subpage-header--tabs",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent two/three-row header reservation follows existing responsive tab wrapping."
  },
  {
    "id": "section-heading",
    "role": "structural-target",
    "selector": ".section-page-header",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent tabbed section-header reservation."
  },
  {
    "id": "section-title",
    "role": "structural-target",
    "selector": ".section-page-header .view-title",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent 44px heading line inside a section header."
  },
  {
    "id": "seating-pool",
    "role": "structural-target",
    "selector": ".seating-player-pool",
    "owner": "public/css/overlays.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent seating drop area includes the row and its surrounding padding."
  },
  {
    "id": "seating-player",
    "role": "structural-target",
    "selector": ".seating-pool-player",
    "owner": "public/css/overlays.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent 44px seating player row."
  },
  {
    "id": "music-copy-actions",
    "role": "standard-control",
    "selector": ".music-copy-row .icon-btn",
    "owner": "public/css/overlays.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Shared 44 by 32px copy actions in music rows."
  },
  {
    "id": "music-cover",
    "role": "structural-target",
    "selector": ".music-cover",
    "owner": "public/css/overlays.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Noninteractive 76px artwork belongs to the music-card structure."
  },
  {
    "id": "kiosk-header-action",
    "role": "structural-target",
    "selector": ".kiosk-header-actions .btn",
    "owner": "public/css/kiosk.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent 44px fullscreen action on the dedicated TV canvas."
  },
  {
    "id": "kiosk-match-row",
    "role": "structural-target",
    "selector": ".kiosk-match-team",
    "owner": "public/css/kiosk.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "reason": "Permanent 44px team row on the dedicated TV canvas."
  }
];

export const temporaryExceptions = [
  {
    "id": "legacy-secondary-modifier",
    "role": "temporary-exception",
    "file": "public/js/views/events.js",
    "selector": ".btn.btn-secondary[data-retry-kiosk-password]",
    "property": "class",
    "reason": "Existing unused modifier; the button already inherits compliant base geometry. Removing legacy naming belongs to package 5.",
    "finding": "The kiosk-password retry template uses btn-secondary, which has no CSS owner or geometry of its own.",
    "targetPackage": 5,
    "removalCriterion": "Remove the unused btn-secondary token from this exact call site when the package-5 modifier migration runs.",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen"
  }
];
