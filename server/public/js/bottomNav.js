// The app has two deliberately small navigation profiles. LAN events keep the
// established party controls; general events promote their everyday planning
// tools into the same six fixed slots. "Mehr" remains the final escape hatch
// in both profiles.

const LAN_ITEMS = Object.freeze([
  Object.freeze({ view: 'home', label: 'Home', ariaLabel: 'Home', iconKey: 'home' }),
  Object.freeze({ view: 'matchmaking', label: 'Match', ariaLabel: 'Match: Teams und Turniere', iconKey: 'competition' }),
  Object.freeze({ view: 'votes', label: 'Vote', ariaLabel: 'Abstimmung', iconKey: 'votes' }),
  Object.freeze({ view: 'foodOrders', label: 'Essen', ariaLabel: 'Essen: Sammelbestellungen koordinieren', iconKey: 'foodOrders', id: 'nav-food-orders' }),
  Object.freeze({ view: 'gameCatalog', label: 'Spiele', ariaLabel: 'Spiele', iconKey: 'gameCatalog' }),
  Object.freeze({ view: 'more', label: 'Mehr', ariaLabel: 'Mehr', iconKey: 'more' }),
]);

const GENERAL_ITEMS = Object.freeze([
  Object.freeze({ view: 'home', label: 'Home', ariaLabel: 'Home', iconKey: 'home' }),
  Object.freeze({ view: 'arrivals', label: 'An & Abreise', ariaLabel: 'An- und Abreise', iconKey: 'arrivals' }),
  Object.freeze({ view: 'checklistPacking', label: 'Packliste', ariaLabel: 'Packliste', iconKey: 'checklistPacking' }),
  Object.freeze({ view: 'checklist', label: 'To-Do', ariaLabel: 'To-Do', iconKey: 'checklist' }),
  Object.freeze({ view: 'eventPolls', label: 'Abstimmungen', labelBreakAfter: 6, ariaLabel: 'Abstimmungen', iconKey: 'eventPolls' }),
  Object.freeze({ view: 'more', label: 'Mehr', ariaLabel: 'Mehr', iconKey: 'more' }),
]);

export function bottomNavItemsForEvent(event) {
  return event?.eventType === 'general' ? GENERAL_ITEMS : LAN_ITEMS;
}
