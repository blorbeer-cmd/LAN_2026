import { escapeHtml } from './format.js';

export function snakeArenaLegendHtml(game) {
  if (game?.gameType !== 'snake' || game.world?.mode !== 'arena') return '';
  const players = game.players ?? [];
  const snakeCount = game.world?.snakes?.length ?? players.length;
  const items = Array.from({ length: snakeCount }, (_, index) => {
    const player = players[index];
    const name = player?.name ?? player?.ref?.name ?? `Spieler ${index + 1}`;
    const status = game.world?.snakes?.[index]?.alive === false ? 'Ausgeschieden' : 'Im Rennen';
    return `<span class="snake-arena-legend-item" role="listitem"><strong>Schlange ${index + 1}</strong><span>${escapeHtml(name)} · ${status}</span></span>`;
  }).join('');
  return `<div class="snake-arena-legend" role="list" aria-label="Zuordnung der Arena-Schlangen">${items}</div>`;
}
