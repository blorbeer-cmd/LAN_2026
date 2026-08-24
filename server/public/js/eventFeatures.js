// Central frontend mapping from routes to whole event areas. Unknown and core
// routes remain available; an older server payload without enabledFeatures
// also preserves the historical all-LAN behavior.

export const VIEW_EVENT_FEATURE = Object.freeze({
  matchmaking: 'competition',
  tournaments: 'competition',
  votes: 'games',
  gameCatalog: 'games',
  foodOrders: 'food',
  checklist: 'tasks',
  checklistPacking: 'tasks',
  arrivals: 'travel',
  music: 'music',
  seating: 'seating',
  leaderboard: 'tracking',
  analytics: 'tracking',
  hallOfFame: 'tracking',
  myStats: 'tracking',
  kiosk: 'kiosk',
  arcade: 'arcade',
  arcadeWatch: 'arcade',
  quizRoom: 'arcade',
  tetris: 'arcade',
  scribbleRoom: 'arcade',
  blobby: 'arcade',
  pong: 'arcade',
  snake: 'arcade',
  battleship: 'arcade',
  challengeRush: 'arcade',
});

export function eventHasFeature(event, featureKey) {
  if (!event || !Array.isArray(event.enabledFeatures)) return true;
  return event.enabledFeatures.includes(featureKey);
}

export function viewIsEnabledForEvent(view, event) {
  const featureKey = VIEW_EVENT_FEATURE[view];
  return featureKey ? eventHasFeature(event, featureKey) : true;
}
