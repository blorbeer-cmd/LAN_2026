export const components = [
  {
    "id": "button",
    "role": "standard-control",
    "selector": ".btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Standard text button; meaning and width compose without changing its interior.",
    "dynamicUses": [
      {
        "file": "public/js/arcade/views/arcadeScribble.js",
        "source": "class=\"btn ${selected ? 'btn-primary' : ''}\"",
        "reason": "Concrete button caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/emptyState.js",
        "source": "class=\"${escapeHtml(className)}\"",
        "reason": "Concrete button caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/events.js",
        "source": "class=\"btn${primary ? ' btn-primary' : ''} btn-sm\"",
        "reason": "Concrete button caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
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
    "purpose": "Width only; inherit the selected geometry.",
    "dynamicUses": [
      {
        "file": "public/js/modal.js",
        "source": "class=\"btn btn-sm btn-equal ${danger ? 'btn-danger' : 'btn-primary'}\"",
        "reason": "Concrete button-width caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/foodOrders.js",
        "source": "class=\"btn btn-sm btn-equal ${danger ? 'btn-danger' : 'btn-primary'}\"",
        "reason": "Concrete button-width caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
  },
  {
    "id": "button-small",
    "role": "standard-control",
    "selector": ".btn-sm",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Compact text at the same 32px minimum height.",
    "dynamicUses": [
      {
        "file": "public/js/arcade/views/arcadeScribble.js",
        "source": "class=\"btn btn-sm ${tool.mode === 'erase' ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/arcade/views/arcadeScribble.js",
        "source": "class=\"btn btn-sm ${tool.mode === 'fill' ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/arcade/views/arcadeScribble.js",
        "source": "class=\"btn btn-sm ${myThumbActive ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/arcade/views/arcadeWatch.js",
        "source": "class=\"btn btn-sm ${watchThumbActive ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/arcade/views/battleship.js",
        "source": "class=\"btn btn-sm ${selectedShip === ship.id ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/feedback.js",
        "source": "class=\"btn btn-sm${selectedSentiment === s.value ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/adminFeedback.js",
        "source": "class=\"btn btn-sm${nextResolved ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/analytics.js",
        "source": "class=\"btn btn-sm ${activeTab === 'playtime' ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/analytics.js",
        "source": "class=\"btn btn-sm ${activeTab === 'matches' ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/analytics.js",
        "source": "class=\"btn btn-sm ${activeTab === 'arcade' ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/checklist.js",
        "source": "class=\"btn btn-sm${form.kind === 'todo' ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/checklist.js",
        "source": "class=\"btn btn-sm${form.kind === 'item_request' ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/checklist.js",
        "source": "class=\"btn btn-sm${form.assignMode === 'none' ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/checklist.js",
        "source": "class=\"btn btn-sm${form.assignMode === 'self' ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/checklist.js",
        "source": "class=\"btn btn-sm${form.assignMode === 'pick' ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/eventPolls.js",
        "source": "class=\"btn btn-sm${draft[option.id] === value ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/gameCatalog.js",
        "source": "class=\"btn btn-sm${active ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/gameCatalog.js",
        "source": "class=\"btn btn-sm ${activeTab === 'catalog' ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/gameCatalog.js",
        "source": "class=\"btn btn-sm ${activeTab === 'suggestions' ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/gameCatalog.js",
        "source": "class=\"btn btn-sm ${activeTab === 'all' ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/matchmaking.js",
        "source": "class=\"btn btn-sm${teamsMode === 'draw' ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/matchmaking.js",
        "source": "class=\"btn btn-sm${teamsMode === 'draft' ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/votes.js",
        "source": "class=\"btn btn-sm ${isSelected ? 'btn-primary' : ''}\"",
        "reason": "Concrete button-small caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
  },
  {
    "id": "button-square",
    "role": "standard-control",
    "selector": ".btn-square",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Numeric poll scale: exactly 32 by 32px, including selected values.",
    "dynamicUses": [
      {
        "file": "public/js/views/eventPolls.js",
        "source": "class=\"btn btn-square${draft[option.id] === value ? ' btn-primary' : ''}\"",
        "reason": "Concrete button-square caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
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
    "purpose": "Wrapping container preserves gap, whole controls and DOM order.",
    "control": false
  },
  {
    "id": "info-trigger",
    "role": "standard-control",
    "selector": ".info-tooltip-trigger, .info-tooltip-trigger--warning",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Help and warning use the same 44 by 32px hit box.",
    "dynamicUses": [
      {
        "file": "public/js/infoTooltip.js",
        "source": "class=\"${triggerClass}\"",
        "reason": "Concrete info-trigger caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
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
    "purpose": "Permanent six-row calendar grid and its 44px day cells.",
    "dynamicUses": [
      {
        "file": "public/js/dateTimeField.js",
        "source": "class=\"${classes.join(' ')}\"",
        "reason": "Concrete calendar-days caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
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
    "purpose": "Profile controls use the standard field/button/icon variants.",
    "dynamicUses": [
      {
        "file": "public/js/views/profile.js",
        "source": "class=\"btn profile-layout-option${layoutPreference === option.value ? ' btn-primary' : ''}\"",
        "reason": "Concrete profile-controls caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
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
    "purpose": "Native textarea rows and 32px sorting buttons.",
    "dynamicUses": [
      {
        "file": "public/js/views/arrivals.js",
        "source": "class=\"arrivals-sort-button${isActive ? ' is-active' : ''}\"",
        "reason": "Concrete arrival-controls caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
  },
  {
    "id": "filter-chip",
    "role": "standard-control",
    "selector": ".chip",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Interactive filter chips use 32px; passive chip labels are outside this control variant.",
    "dynamicUses": [
      {
        "file": "public/js/views/adminFeedback.js",
        "source": "class=\"chip${feedbackSentimentFilter === option.value ? ' is-active' : ''}\"",
        "reason": "Concrete filter-chip caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/checklist.js",
        "source": "class=\"chip${typeFilter === 'all' ? ' is-active' : ''}\"",
        "reason": "Concrete filter-chip caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/checklist.js",
        "source": "class=\"chip${typeFilter === 'todo' ? ' is-active' : ''}\"",
        "reason": "Concrete filter-chip caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/checklist.js",
        "source": "class=\"chip${typeFilter === 'item_request' ? ' is-active' : ''}\"",
        "reason": "Concrete filter-chip caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/checklist.js",
        "source": "class=\"chip${onlyMineFilter ? ' is-active' : ''}\"",
        "reason": "Concrete filter-chip caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/events.js",
        "source": "class=\"chip${entry.id === 'alle' ? ' is-active' : ''}\"",
        "reason": "Concrete filter-chip caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/gameCatalog.js",
        "source": "class=\"chip${selectedGenres.has(g) ? ' is-active' : ''}\"",
        "reason": "Concrete filter-chip caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/gameCatalog.js",
        "source": "class=\"chip${genreFilter.has(g) ? ' is-active' : ''}\"",
        "reason": "Concrete filter-chip caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/gameCatalog.js",
        "source": "class=\"chip${ratingFilter.has('bock') ? ' is-active' : ''}\"",
        "reason": "Concrete filter-chip caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/gameCatalog.js",
        "source": "class=\"chip${ratingFilter.has('skill') ? ' is-active' : ''}\"",
        "reason": "Concrete filter-chip caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/votes.js",
        "source": "class=\"chip${voteUnratedOnly ? ' is-active' : ''}\"",
        "reason": "Concrete filter-chip caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
  },
  {
    "id": "section-tab",
    "role": "standard-control",
    "selector": ".section-tab",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Navigation button composed with the base button and optional meaning modifier.",
    "dynamicUses": [
      {
        "file": "public/js/sectionNav.js",
        "source": "class=\"btn btn-sm section-tab${active ? ' btn-primary' : ''}\"",
        "reason": "Concrete section-tab caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
  },
  {
    "id": "poll-choice",
    "role": "standard-control",
    "selector": ".event-poll-choice-btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#tokens-und-einzeilige-controls",
    "purpose": "Compact choice text retains the standard minimum height.",
    "dynamicUses": [
      {
        "file": "public/js/views/eventPolls.js",
        "source": "event-poll-choice-btn${selected ? ' btn-primary' : ''}",
        "reason": "Literal class followed by a conditional meaning modifier; this exact template supplies the registered choice control."
      }
    ]
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
    "purpose": "Only the account-access row contains the 320px name/badge/action reflow query.",
    "control": false
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
    "purpose": "32px payment/copy actions; icon actions inherit the shared minimum width.",
    "dynamicUses": [
      {
        "file": "public/js/views/events.js",
        "source": "class=\"payment-paid-marker ${participant.paid ? 'is-paid' : ''}\"",
        "reason": "Concrete payment-controls caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/events.js",
        "source": "class=\"payment-paid-marker ${isPaid ? 'is-paid' : ''}\"",
        "reason": "Concrete payment-controls caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/foodOrders.js",
        "source": "class=\"payment-paid-marker food-order-paid-marker ${allPaid ? 'is-paid' : ''}\"",
        "reason": "Concrete payment-controls caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
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
    "purpose": "Each team is one half of the fixed composite bracket match; states own no separate height.",
    "dynamicUses": [
      {
        "file": "public/js/tournamentPresentation.js",
        "source": "class=\"${cls}\"",
        "reason": "Concrete bracket-row caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
  },
  {
    "id": "rating-slider",
    "role": "composite-part",
    "selector": ".skill-row-slider, .skill-row-slider-unset, .preference-row-slider",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Existing slider track/thumb geometry is internal to the rating control.",
    "dynamicUses": [
      {
        "file": "public/js/views/gameCatalog.js",
        "source": "class=\"skill-row-slider ${accentClass}${isUnset ? ' skill-row-slider-unset' : ''}\"",
        "reason": "Concrete rating-slider caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
  },
  {
    "id": "rating-suggestion",
    "role": "composite-part",
    "selector": ".skill-suggestion-chip, .skill-suggestion-chip-diverges",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Inline application shortcut belongs to the rating label, with its existing icon/value geometry.",
    "dynamicUses": [
      {
        "file": "public/js/views/gameCatalog.js",
        "source": "class=\"skill-suggestion-chip ${diverges ? 'skill-suggestion-chip-diverges' : ''}\"",
        "reason": "Concrete rating-suggestion caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
  },
  {
    "id": "structural-cards",
    "role": "structural-target",
    "selector": ".card, .list-row, .more-card, .home-current-navigate, .notification-highlight-link, .tournament-list-card",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Whole navigation/result cards preserve their existing row or multiline card geometry.",
    "control": false
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
    "purpose": "Whole roster cards for picking/reordering, not standalone text buttons.",
    "dynamicUses": [
      {
        "file": "public/js/views/matchmaking.js",
        "source": "class=\"team-player tournament-drag-player${selectedDrawPlayer?.drawId === draw.id && selectedDrawPlayer.playerId === p.id ? ' is-selected' : ''}\"",
        "reason": "Concrete player-selection-actions caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/tournament.js",
        "source": "class=\"team-player tournament-drag-player${createSelectedPlayerId === p.id ? ' is-selected' : ''}\"",
        "reason": "Concrete player-selection-actions caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
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
    "purpose": "Layout attachment; the semantic control variant still owns its interior.",
    "control": false
  },
  {
    "id": "selection-state",
    "role": "composite-part",
    "selector": ".is-active, .is-selected",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Context-owned selection markers; no standalone control geometry.",
    "control": false
  },
  {
    "id": "payment-state",
    "role": "composite-part",
    "selector": ".is-paid",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Payment state marker inherits its host control geometry.",
    "control": false
  },
  {
    "id": "arcade-segment",
    "role": "composite-part",
    "selector": ".arcade-mode-toggle, .arcade-mode-toggle-btn, .arcade-lobby-create-row",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Package-1 segment/pill and creation-row contract remains 32px; S stays 188px.",
    "dynamicUses": [
      {
        "file": "public/js/arcade/lobbyReady.js",
        "source": "class=\"arcade-mode-toggle-btn${active ? ' is-active' : ''}\"",
        "reason": "Concrete arcade-segment caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
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
    "purpose": "Whole game-selection tile retains its name, status and card geometry.",
    "dynamicUses": [
      {
        "file": "public/js/arcade/views/arcade.js",
        "source": "class=\"card arcade-tile ${active === game.id ? 'is-active' : ''} ${game.soon ? 'is-soon' : ''}\"",
        "reason": "Concrete arcade-tile caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
  },
  {
    "id": "battleship-grid",
    "role": "structural-target",
    "selector": ".battleship-cell, .is-ship, .is-hit, .is-miss",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#strukturziele-mit-44-px",
    "purpose": "Permanent 44px game-board cells; ship and hit states do not change geometry.",
    "dynamicUses": [
      {
        "file": "public/js/arcade/views/battleship.js",
        "source": "class=\"battleship-cell ${segment?.className ?? ''}\"",
        "reason": "Concrete battleship-grid caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/arcade/views/battleship.js",
        "source": "class=\"battleship-cell ${shot ? `is-${shot}` : ''} ${selected ? 'is-selected' : ''}\"",
        "reason": "Concrete battleship-grid caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
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
    "purpose": "Existing game reaction targets, choice tiles and memory cells keep their dedicated geometry.",
    "dynamicUses": [
      {
        "file": "public/js/arcade/views/challengeRush.js",
        "source": "class=\"btn challenge-rush-memory-cell${selected.has(index) ? ' is-selected' : ''}\"",
        "reason": "Concrete challenge-targets caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
  },
  {
    "id": "scribble-tools",
    "role": "composite-part",
    "selector": ".scribble-size-btn, .scribble-swatch, .scribble-swatch-active",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#zusatzklassen-und-zusammengesetzte-controls",
    "purpose": "Internal brush-width and color samples in the drawing palette retain existing dimensions.",
    "dynamicUses": [
      {
        "file": "public/js/arcade/views/arcadeScribble.js",
        "source": "class=\"scribble-swatch ${tool.mode !== 'erase' && tool.color === color ? 'scribble-swatch-active' : ''}\"",
        "reason": "Concrete scribble-tools caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/arcade/views/arcadeScribble.js",
        "source": "class=\"btn btn-sm scribble-size-btn ${tool.mode !== 'erase' && tool.size === size ? 'btn-primary' : ''}\"",
        "reason": "Concrete scribble-tools caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
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
    "purpose": "Pairing icon and result-type buttons inherit shared control geometry.",
    "dynamicUses": [
      {
        "file": "public/js/views/music.js",
        "source": "class=\"btn music-result-type-button${activeType === 'tracks' ? ' btn-primary' : ''}\"",
        "reason": "Concrete music-controls caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      },
      {
        "file": "public/js/views/music.js",
        "source": "class=\"btn music-result-type-button${activeType === 'playlists' ? ' btn-primary' : ''}\"",
        "reason": "Concrete music-controls caller composes selection/state classes; the static inventory does not infer the runtime branch. Component geometry remains owned by this entry."
      }
    ]
  },
  {
    "id": "native-control-line",
    "role": "composite-part",
    "selector": "button, input",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "The shared native control line-height rule owns the element baseline."
  },
  {
    "id": "native-color",
    "role": "composite-part",
    "selector": "input[type='color']",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Existing native color swatch is a structural picker surface, not a text field."
  },
  {
    "id": "native-range",
    "role": "composite-part",
    "selector": "input[type='range']",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Native range track fills its rating row; thumb geometry remains with the slider."
  },
  {
    "id": "poll-option-link",
    "role": "composite-part",
    "selector": ".event-poll-option-link",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Link action composes icon-button; only nonshrinking placement belongs to this attachment."
  },
  {
    "id": "kiosk-open-link",
    "role": "composite-part",
    "selector": ".kiosk-open-link",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Literal event-card action hook inherits the base button; no independent interior geometry.",
    "control": false
  },
  {
    "id": "arcade-player-surface",
    "role": "composite-part",
    "selector": ".arcade-player-tile",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Winner emphasis belongs to the existing player surface, not to an independent control.",
    "control": false
  },
  {
    "id": "draw-team-surface",
    "role": "composite-part",
    "selector": ".matchmaking-draw-team",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Winner emphasis belongs to the existing drawn-team surface.",
    "control": false
  },
  {
    "id": "onboarding-target-ring",
    "role": "composite-part",
    "selector": ".onboarding-target-ring",
    "owner": "public/css/overlays.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Noninteractive tour decoration follows the highlighted element rectangle; it never resizes that control.",
    "control": false,
    "calls": [
      {
        "file": "public/js/onboarding.js",
        "callKey": "ring.style.width",
        "property": "width",
        "value": "`${rect.width}px`"
      },
      {
        "file": "public/js/onboarding.js",
        "callKey": "ring.style.height",
        "property": "height",
        "value": "`${rect.height}px`"
      }
    ]
  },
  {
    "id": "empty-state",
    "role": "composite-part",
    "selector": ".empty-state, .empty-state-structured, .empty-state-actions",
    "owner": "public/css/style.css",
    "contract": "components/empty-state.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Shared empty-state text, structure and recovery layout.",
    "control": false
  },
  {
    "id": "empty-state-compact",
    "role": "composite-part",
    "selector": ".empty-state-compact",
    "owner": "public/css/style.css",
    "contract": "components/empty-state.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Preserves the individually inventoried 16px padding of shallow loading/result slots.",
    "control": false
  },
  {
    "id": "empty-state-food-items",
    "role": "composite-part",
    "selector": ".empty-state-food-items",
    "owner": "public/css/domains.css",
    "contract": "components/empty-state.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Preserves small copy and vertical spacing in the empty food-position list.",
    "control": false
  },
  {
    "id": "empty-state-kiosk-loading",
    "role": "composite-part",
    "selector": ".empty-state-kiosk-loading",
    "owner": "public/css/kiosk.css",
    "contract": "components/empty-state.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Preserves the TV loading canvas inset.",
    "control": false
  },
  {
    "id": "empty-state-vote",
    "role": "composite-part",
    "selector": ".vote-empty-state",
    "owner": "public/css/domains.css",
    "contract": "components/empty-state.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Centered result/history slot in Vote.",
    "control": false
  },
  {
    "id": "empty-state-tournament",
    "role": "composite-part",
    "selector": ".tournament-list-empty",
    "owner": "public/css/style.css",
    "contract": "components/empty-state.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Stable tournament collection empty slot.",
    "control": false
  },
  {
    "id": "empty-state-hall-of-fame",
    "role": "composite-part",
    "selector": ".hall-of-fame-empty-result",
    "owner": "public/css/domains.css",
    "contract": "components/empty-state.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Hall-of-Fame result slot spans the result layout.",
    "control": false
  },
  {
    "id": "empty-state-arrivals",
    "role": "composite-part",
    "selector": ".arrivals-carpool-empty",
    "owner": "public/css/style.css",
    "contract": "components/empty-state.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Empty arrival collection occupies the carpool grid.",
    "control": false
  },
  {
    "id": "empty-state-notifications",
    "role": "composite-part",
    "selector": ".notification-center-empty",
    "owner": "public/css/style.css",
    "contract": "components/empty-state.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Shared empty/loading/error slot inside the notification panel.",
    "control": false
  },
  {
    "id": "empty-state-music",
    "role": "composite-part",
    "selector": ".music-no-playback",
    "owner": "public/css/overlays.css",
    "contract": "components/empty-state.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Centered current-playback placeholder.",
    "control": false
  },
  {
    "id": "empty-state-kiosk",
    "role": "composite-part",
    "selector": ".kiosk-vote-empty, .kiosk-vote-state",
    "owner": "public/css/kiosk.css",
    "contract": "components/empty-state.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "TV vote placeholders fill their existing dashboard region.",
    "control": false
  },
  {
    "id": "invite-link-field",
    "role": "standard-control",
    "selector": ".invite-link-field",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "purpose": "Small invitation URL text moves from the Admin caller to its field owner; the control height is unchanged."
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
  },
  {
    "id": "arcade-create-width",
    "role": "composite-part",
    "selector": ".arcade-lobby-create-actions .btn, .arcade-lobby-create-row > .btn, .arcade-lobby-create-row > .arcade-mode-toggle",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width",
      "min-width"
    ],
    "reason": "Creation-row container controls available width and stacking; no CTA interior dimensions."
  },
  {
    "id": "arcade-free-slot-width",
    "role": "composite-part",
    "selector": ".arcade-lobby-free-row .btn",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width"
    ],
    "reason": "Join action fills its reserved free-player slot."
  },
  {
    "id": "arcade-entry-width",
    "role": "composite-part",
    "selector": ".arcade-lobby-entry-actions > .btn",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "min-width"
    ],
    "reason": "Whole entry actions yield to their wrapping footer."
  },
  {
    "id": "arcade-setting-row",
    "role": "composite-part",
    "selector": ".arcade-lobby-setting-options .check-row",
    "owner": "public/css/arcade.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "padding"
    ],
    "reason": "Existing composite checkbox setting row, not a standalone text button."
  },
  {
    "id": "bracket-action-gutter",
    "role": "composite-part",
    "selector": ".bracket-match.has-result-action .bracket-team-row",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "padding-right"
    ],
    "reason": "Composite bracket row reserves the embedded result-action gutter."
  },
  {
    "id": "checkbox-in-row",
    "role": "composite-part",
    "selector": ".check-row input[type='checkbox']",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width",
      "height"
    ],
    "reason": "Native checkbox glyph is an internal 20px part of the labeled selection row."
  },
  {
    "id": "event-calendar-actions",
    "role": "composite-part",
    "selector": ".event-calendar-action-buttons .btn",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "min-width",
      "white-space"
    ],
    "reason": "Calendar handoff labels may wrap within their equal-width action group."
  },
  {
    "id": "event-excuse-actions",
    "role": "composite-part",
    "selector": ".event-excuse-actions .btn",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "min-width",
      "white-space"
    ],
    "reason": "Parallel excuse actions wrap labels within the available footer."
  },
  {
    "id": "event-card-action-width",
    "role": "composite-part",
    "selector": ".event-card-actions .btn",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "min-width"
    ],
    "reason": "Event card actions yield width to whole-group reflow."
  },
  {
    "id": "grouped-card-surface",
    "role": "composite-part",
    "selector": ".grouped-page-section .card",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "box-shadow"
    ],
    "reason": "Nested card surface removes redundant elevation."
  },
  {
    "id": "tournament-skill-field",
    "role": "composite-part",
    "selector": ".tournament-team-skill-header input",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width",
      "min-width"
    ],
    "reason": "Team skill field fits the header alongside the team label."
  },
  {
    "id": "vote-selection-row",
    "role": "composite-part",
    "selector": ".vote-game-grid .check-row",
    "owner": "public/css/domains.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "min-width",
      "padding",
      "border-radius"
    ],
    "reason": "Existing game-selection card frame and inset; native checkbox owns its glyph."
  },
  {
    "id": "kiosk-player-card",
    "role": "composite-part",
    "selector": ".kiosk-card .player-card, .kiosk-live-grid .player-card",
    "owner": "public/css/kiosk.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "font-size",
      "min-width",
      "padding"
    ],
    "reason": "Read-only TV player surface retains the separate device-class text scale and inset."
  },
  {
    "id": "kiosk-title",
    "role": "composite-part",
    "selector": ".kiosk-header .topbar-title",
    "owner": "public/css/kiosk.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "font-size"
    ],
    "reason": "TV header keeps its documented title scale."
  },
  {
    "id": "kiosk-login-field",
    "role": "composite-part",
    "selector": ".kiosk-login-card input",
    "owner": "public/css/kiosk.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width"
    ],
    "reason": "Native login field fills the centered TV login card."
  },
  {
    "id": "kiosk-winner",
    "role": "composite-part",
    "selector": ".kiosk-match-team.is-winner",
    "owner": "public/css/kiosk.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "box-shadow"
    ],
    "reason": "TV winner rail supplements its textual winner state."
  },
  {
    "id": "onboarding-rating-actions",
    "role": "composite-part",
    "selector": ".onboarding-rating-dialog .onboarding-rating-actions .btn",
    "owner": "public/css/overlays.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "min-width",
      "padding-inline",
      "font-size",
      "white-space"
    ],
    "reason": "Existing rating-panel composite action row keeps its short application labels and horizontal density at the shared minimum height."
  },
  {
    "id": "seating-field-width",
    "role": "composite-part",
    "selector": ".seating-control-grid input",
    "owner": "public/css/overlays.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "min-width"
    ],
    "reason": "Seating editor fields yield within their configuration grid."
  },
  {
    "id": "desktop-nav-indicator",
    "role": "composite-part",
    "selector": ":root[data-layout-mode='desktop'] .desktop-nav-btn::before",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width",
      "height",
      "border-radius"
    ],
    "reason": "Internal active navigation indicator preserves the whole navigation target."
  },
  {
    "id": "arrival-action-width",
    "role": "composite-part",
    "selector": ".arrivals-carpool-actions .btn, .arrivals-free-seat-row .btn",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width"
    ],
    "reason": "Carpool actions occupy the existing footer or free-seat action column."
  },
  {
    "id": "calendar-month-fields",
    "role": "composite-part",
    "selector": ".dt-popover-month-year select",
    "owner": "public/css/style.css",
    "contract": "components/date-time-field.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "min-width",
      "padding",
      "font-size"
    ],
    "reason": "Month/year selectors are internal calendar parts at the shared control height."
  },
  {
    "id": "event-context-search-field",
    "role": "composite-part",
    "selector": ".event-context .search-select-control > input",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "padding-right"
    ],
    "reason": "Compact event switcher reserves its integrated selector action."
  },
  {
    "id": "search-status-reserve",
    "role": "composite-part",
    "selector": ".search-select.has-status-icon .search-select-control > input",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "padding-left"
    ],
    "reason": "Searchable select reserves the established status icon inside the field."
  },
  {
    "id": "number-stepper-reserve",
    "role": "composite-part",
    "selector": ".number-stepper input[type='number']",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "padding-right"
    ],
    "reason": "Native number field reserves the internal half-stepper column."
  },
  {
    "id": "selection-number-width",
    "role": "composite-part",
    "selector": ".selection-toolbar input[type='number']",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width"
    ],
    "reason": "Existing numeric selection field has a stable toolbar column."
  },
  {
    "id": "selection-search-field",
    "role": "composite-part",
    "selector": ".selection-search-field input",
    "owner": "public/css/style.css",
    "contract": "components/selection-search.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "min-width",
      "width"
    ],
    "reason": "Shared search field fills its wrapping search container."
  },
  {
    "id": "tournament-count-width",
    "role": "composite-part",
    "selector": ".tournament-team-count-field input[type='number']",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width"
    ],
    "reason": "Team count fills its labeled field column."
  },
  {
    "id": "roster-selection-frame",
    "role": "composite-part",
    "selector": ".player-selection-grid .check-row",
    "owner": "public/css/style.css",
    "contract": "components/roster-picker.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "min-width",
      "padding",
      "border-radius"
    ],
    "reason": "Shared roster owns the checkbox-card inset, border radius and safe name reflow."
  },
  {
    "id": "profile-agent-field",
    "role": "composite-part",
    "selector": ".profile-agent-key-row input",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "min-width"
    ],
    "reason": "Agent key field yields to its neighboring copy action."
  },
  {
    "id": "player-assignment-field",
    "role": "composite-part",
    "selector": ".player-assignment-row select",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width"
    ],
    "reason": "Player assignment select fills its row column."
  },
  {
    "id": "icon-button-glyph",
    "role": "composite-part",
    "selector": ".icon-btn .ui-icon",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width",
      "height"
    ],
    "reason": "Base icon-button owns its 20px glyph independently of hit-box geometry."
  },
  {
    "id": "chip-glyph",
    "role": "composite-part",
    "selector": ".chip .ui-icon",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width",
      "height"
    ],
    "reason": "Chip component owns its 15px glyph."
  },
  {
    "id": "number-stepper-glyph",
    "role": "composite-part",
    "selector": ".number-stepper-btn .ui-icon",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width",
      "height"
    ],
    "reason": "Supplementary half-stepper owns its 11px arrow glyph."
  },
  {
    "id": "rating-suggestion-glyph",
    "role": "composite-part",
    "selector": ".skill-suggestion-chip .ui-icon",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width",
      "height"
    ],
    "reason": "Inline rating shortcut owns its 14px glyph."
  },
  {
    "id": "arrival-sort-glyph",
    "role": "composite-part",
    "selector": ".arrivals-sort-button .ui-icon",
    "owner": "public/css/style.css",
    "contract": "components/controls.md#11-permanente-varianten-und-befristete-ausnahmen",
    "properties": [
      "width",
      "height"
    ],
    "reason": "Sort control owns its font-relative glyph."
  }
];

export const temporaryExceptions = [];
