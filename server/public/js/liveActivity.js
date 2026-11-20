// DOM-free helpers for "what is being played right now", shared by Home's
// Live-Status and the Broadcast (kiosk) Live-Status so both screens group and
// name running games the same way.

// Groups currently-playing players by game, the game with the most players
// first (ties by name so the order never flips between refreshes). Each
// group lists its player names alphabetically.
export function activeGameGroups(players) {
  const byGame = new Map();
  for (const p of players) {
    if (p.state !== 'playing') continue;
    for (const g of p.games ?? []) {
      const entry = byGame.get(g.game_id) ?? { id: g.game_id, name: g.game_name, icon: g.game_icon, players: [] };
      entry.players.push(p.name);
      byGame.set(g.game_id, entry);
    }
  }
  return [...byGame.values()]
    .map((g) => ({ ...g, players: g.players.slice().sort((a, b) => a.localeCompare(b, 'de')) }))
    .sort((a, b) => b.players.length - a.players.length || a.name.localeCompare(b.name, 'de'));
}

// The names of a player's running games. When the agent reports which window
// is in front and several games run at once, the foreground game leads.
export function runningGameNames(player) {
  const games = player.games ?? [];
  const foregroundFirst = player.activity_tracked && games.length > 1
    ? [...games].sort((a, b) => Number(Boolean(b.foreground)) - Number(Boolean(a.foreground)))
    : games;
  return foregroundFirst.map((g) => g.game_name);
}
