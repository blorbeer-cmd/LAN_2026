import { escapeHtml, avatarHtml } from '../format.js';
import { arcadeMuteControlHtml, wireArcadeMuteControl } from './arcadeSound.js';
import { arcadeFullscreenControlHtml, wireArcadeFullscreenControl, wireArcadePlayfieldFit } from './arcadePlayfield.js';
import { playerById } from '../state.js';

// Combines the mute toggle with the fullscreen control in one right-aligned
// row so every game exposes both from the same shell header instead of each
// view wiring its own placement.
export function arcadeToolbarHtml() {
  return `<div class="arcade-toolbar">${arcadeMuteControlHtml()}${arcadeFullscreenControlHtml()}</div>`;
}

// Shared page header of a running game: the title on the left, the match
// controls (pause, end, leave) and the mute/fullscreen icons on the right.
// Games replace only `.arcade-match-controls` on pause or host changes.
// `titleInfoHtml` is an optional InfoTooltip directly right of the title.
export function arcadeGameHeaderHtml(title, controlsHtml = '', { fullscreen = true, mute = true, titleInfoHtml = '' } = {}) {
  const heading = `<h1 class="view-title">${escapeHtml(title)}</h1>`;
  return `<div class="arcade-game-header">
    ${titleInfoHtml ? `<div class="title-with-info">${heading}${titleInfoHtml}</div>` : heading}
    <div class="arcade-game-header-actions">
      ${controlsHtml}
      ${mute ? arcadeMuteControlHtml() : ''}${fullscreen ? arcadeFullscreenControlHtml() : ''}
    </div>
  </div>`;
}

export function arcadeMatchControlsHtml(buttons) {
  return `<div class="arcade-match-controls">${buttons}</div>`;
}

export function pointsLabel(points) {
  return `${points} ${points === 1 ? 'Punkt' : 'Punkte'}`;
}

// Final standings after a match: place, player and the score in a fixed right
// column. The winner's score is green, everyone else is muted. `me` marks the
// own row where a list has no winner (Chimp Test round ranking).
export function arcadeResultListHtml(rows) {
  const hasWinner = rows.some((row) => row.winner);
  return `<div class="arcade-result-list${hasWinner ? ' has-winner' : ''}">${rows
    .map((row, index) => {
      const player = { ...(playerById(row.player.id) ?? {}), ...row.player };
      return `<div class="arcade-result-row${row.winner ? ' is-winner' : ''}${row.me ? ' is-me' : ''}">
        <span class="arcade-result-rank">${row.place ?? index + 1}</span>
        <span class="arcade-result-player">${row.colorVar ? `<span class="arcade-result-swatch" style="background:${row.colorVar}" aria-hidden="true"></span>` : avatarHtml(player, 24)}<span class="arcade-result-text"><span class="player-name">${escapeHtml(row.player.name)}</span>${row.detail ? `<span class="arcade-result-detail">${escapeHtml(row.detail)}</span>` : ''}</span></span>
        <strong class="arcade-result-value">${escapeHtml(row.value ?? '')}${row.winner ? '<span class="visually-hidden"> · Sieg</span>' : ''}</strong>
      </div>`;
    })
    .join('')}</div>`;
}

// Wires the header icons and fits the playfield to the screen. Every game
// room calls this after each full render.
export function wireArcadeToolbar(container) {
  wireArcadeMuteControl(container);
  wireArcadeFullscreenControl(container);
  wireArcadePlayfieldFit(container);
}

export function matchRosterHtml(players, { winnerId = null, winnerIds = [], scoreFor = null, detailFor = null } = {}) {
  const winners = new Set(winnerIds);
  return `
    <div class="arcade-roster">
      ${players
        .map((player, index) => {
          const score = scoreFor ? scoreFor(player, index) : null;
          const detail = detailFor ? detailFor(player, index) : '';
          const classes = ['arcade-player-tile'];
          if ((winnerId && winnerId === player.id) || winners.has(player.id)) classes.push('is-winner');
          return `
            <div class="${classes.join(' ')}">
              ${avatarHtml(player, 34)}
              <div class="arcade-player-tile-body">
                <strong>${escapeHtml(player.name)}</strong>
                ${score !== null && score !== undefined && score !== '' ? `<span class="arcade-player-tile-score">${escapeHtml(score)}</span>` : ''}
                ${detail ? `<span class="arcade-player-tile-detail">${escapeHtml(detail)}</span>` : ''}
              </div>
            </div>`;
        })
        .join('')}
    </div>`;
}

// Score bar above a two-sided playfield (Pong, Blobby Volley): players of the
// left side, the score in the side colors with the target below, players of
// the right side. Side colors match the paddles/blobs on the canvas; the team
// name stays readable as text, so meaning never rests on color alone.
export function arcadeScoreboardHtml({ left, right, target = null, myId = null }) {
  const sideHtml = (side, align) => `<div class="arcade-scoreboard-side is-${align}">
    ${side.players
      .map((player) => {
        const profile = { ...(playerById(player.id) ?? {}), ...player };
        const marker = player.colorVar ? `<span class="arcade-scoreboard-swatch" style="background:${player.colorVar}" aria-hidden="true"></span>` : avatarHtml(profile, 20);
        return `<span class="arcade-scoreboard-player">${marker}<span class="player-name${player.id === myId ? ' is-me' : ''}">${escapeHtml(player.name)}</span>${player.detail ? `<span class="arcade-scoreboard-detail">${escapeHtml(player.detail)}</span>` : ''}</span>`;
      })
      .join('')}
    <span class="arcade-scoreboard-label">${escapeHtml(side.label)}</span>
  </div>`;
  return `<div class="arcade-scoreboard">
    ${sideHtml(left, 'left')}
    <div class="arcade-scoreboard-score" aria-label="${escapeHtml(`${left.label} ${left.score}, ${right.label} ${right.score}`)}">
      <span class="is-left">${left.score}</span><span class="arcade-scoreboard-sep">:</span><span class="is-right">${right.score}</span>
      ${target ? `<small>bis ${target}</small>` : ''}
    </div>
    ${sideHtml(right, 'right')}
  </div>`;
}

// Players of a free-for-all playfield (Snake): the color the player steers on
// the canvas, the name, a short status and the current score. The own entry
// is bold and says "Du"; eliminated players are muted.
export function arcadePlayerStripHtml(entries) {
  return `<div class="arcade-player-strip">${entries
    .map((entry) => `<div class="arcade-player-strip-item${entry.out ? ' is-out' : ''}">
      <span class="arcade-player-strip-color" style="background:${entry.colorVar}" aria-hidden="true"></span>
      <span class="arcade-player-strip-text">
        <span class="player-name${entry.me ? ' is-me' : ''}">${escapeHtml(entry.name)}${entry.me ? ' · Du' : ''}</span>
        ${entry.detail ? `<span class="arcade-player-strip-detail">${escapeHtml(entry.detail)}</span>` : ''}
      </span>
      <strong class="arcade-player-strip-value">${escapeHtml(entry.value ?? '')}</strong>
    </div>`)
    .join('')}</div>`;
}
