// TV-/Kiosk dashboard: a read-only, auto-refreshing overview for a shared
// screen at the party (a monitor, a beamer) — nobody interacts with this,
// it just always shows current state. Reuses the same api.js/socket.js/
// format.js modules the main app uses, but renders its own compact layout
// rather than the phone-sized views (see kiosk.html/css).

import { api, getKioskToken, setKioskMode, setKioskToken } from './api.js';
import { connectSocket } from './socket.js';
import { escapeHtml, stateLabel, avatarHtml } from './format.js';
import { installIconReplacement, icon } from './icons.js';
import { bannerContentHtml } from './pushFeed.js';
import { drawArcadeStreamCanvas } from './arcade/shared/arcadeStreamRenderer.js';
import { domainIcon, installDomainIcons } from './domainIcons.js';
import { snakeArenaLegendHtml } from './arcade/shared/snakeArenaLegend.js';
import { emptyStateHtml } from './emptyState.js';
import { kioskMusicQueueHtml, kioskMusicQueueKey } from './kioskMusic.js';
import {
  connectLocalSpotifyPlayer,
  localSpotifyPlaybackStatus,
  localSpotifyPlayerInfo,
  localSpotifySessionNeedsRecovery,
  preloadSpotifyPlaybackSdk,
  LOCAL_CONTROLLER_URL,
} from './spotifyBrowserPlayer.js';

installIconReplacement();
installDomainIcons();
setKioskMode(true);

const STATE_RANK = { playing: 0, online: 1, paused: 2, offline: 3 };
const GAME_NAMES = { quiz: 'Gaming-Quiz', tetris: 'Tetris', scribble: 'Scribble', blobby: 'Blobby Volley', pong: 'Pong', snake: 'Snake', 'challenge-rush': 'Challenge Rush' };
const KIOSK_REFRESH_INTERVAL_MS = 60_000;
const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function drawLegacyKioskCanvas(canvas, game) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cssColor('--bg');
  ctx.fillRect(0, 0, w, h);

  if (game.gameType === 'scribble') {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const op of game.strokes || []) {
      if (op.type === 'fill') {
        const x = Math.max(0, Math.min(w - 1, Math.round(op.x * w)));
        const y = Math.max(0, Math.min(h - 1, Math.round(op.y * h)));
        const image = ctx.getImageData(0, 0, w, h);
        const target = (y * w + x) * 4;
        const replacement = document.createElement('canvas').getContext('2d');
        if (!replacement) continue;
        replacement.fillStyle = op.color;
        replacement.fillRect(0, 0, 1, 1);
        const color = replacement.getImageData(0, 0, 1, 1).data;
        const start = [image.data[target], image.data[target + 1], image.data[target + 2], image.data[target + 3]];
        if (start.every((value, index) => value === color[index])) continue;
        const stack = [[x, y]];
        while (stack.length) {
          const [px, py] = stack.pop();
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const offset = (py * w + px) * 4;
          if (!start.every((value, index) => image.data[offset + index] === value)) continue;
          color.forEach((value, index) => { image.data[offset + index] = value; });
          stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
        }
        ctx.putImageData(image, 0, 0);
        continue;
      }
      if (op.type !== 'stroke' || !op.points?.length) continue;
      ctx.beginPath();
      ctx.strokeStyle = op.erase ? cssColor('--bg') : op.color;
      ctx.lineWidth = op.size * 2;
      op.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
      ctx.stroke();
    }
    return;
  }

  if (game.gameType === 'tetris') {
    const boards = game.players || [];
    const columns = boards.length <= 2 ? Math.max(1, boards.length) : boards.length <= 4 ? 2 : 4;
    const rows = Math.ceil(boards.length / columns);
    const boardW = w / columns;
    const boardH = h / Math.max(1, rows);
    boards.forEach((player, index) => {
      const column = index % columns;
      const rowIndex = Math.floor(index / columns);
      const left = column * boardW + boardW * 0.1;
      const top = rowIndex * boardH + boardH * 0.06;
      const bw = boardW * 0.8;
      const bh = boardH * 0.8;
      const cell = Math.min(bw / 10, bh / 20);
      ctx.globalAlpha = player.alive === false ? 0.45 : 1;
      ctx.fillStyle = cssColor('--bg-elevated');
      ctx.fillRect(left, top, cell * 10, cell * 20);
      (player.board || []).forEach((row, y) => row.forEach((value, x) => {
        if (!value) return;
        ctx.fillStyle = cssColor('--accent');
        ctx.fillRect(left + x * cell, top + y * cell, cell - 1, cell - 1);
      }));
      if (player.current) {
        ctx.fillStyle = player.current.color || cssColor('--accent-2');
        player.current.cells.forEach(([x, y]) => ctx.fillRect(left + x * cell, top + y * cell, cell - 1, cell - 1));
      }
      ctx.fillStyle = cssColor('--text');
      ctx.font = `${parseFloat(getComputedStyle(document.body).fontSize) * 1.5}px sans-serif`;
      ctx.fillText(player.name || 'Spieler', left, (rowIndex + 1) * boardH - 4);
      ctx.globalAlpha = 1;
    });
    return;
  }

  const world = game.world;
  if (!world) return;
  if (game.gameType === 'pong') {
    const scaleX = w / 800;
    const scaleY = h / 450;
    ctx.fillStyle = cssColor('--accent'); ctx.fillRect(world.paddles[0].x * scaleX, world.paddles[0].y * scaleY, 12, world.paddles[0].height * scaleY);
    ctx.fillStyle = cssColor('--accent-3'); ctx.fillRect(world.paddles[1].x * scaleX, world.paddles[1].y * scaleY, 12, world.paddles[1].height * scaleY);
    ctx.fillStyle = cssColor('--text'); ctx.beginPath(); ctx.arc(world.ball.x * scaleX, world.ball.y * scaleY, 10, 0, Math.PI * 2); ctx.fill();
  } else if (game.gameType === 'blobby') {
    const sx = w / 1000;
    const sy = h / 600;
    ctx.strokeStyle = cssColor('--accent-2'); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    world.blobs.forEach((blob, index) => { ctx.fillStyle = index ? cssColor('--accent-3') : cssColor('--accent'); ctx.beginPath(); ctx.arc(blob.x * sx, blob.y * sy, 28, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = cssColor('--rank-1-gold'); ctx.beginPath(); ctx.arc(world.ball.x * sx, world.ball.y * sy, 16, 0, Math.PI * 2); ctx.fill();
  }
}

function drawKioskCanvas(canvas, game) {
  if (GAME_NAMES[game.gameType]) {
    drawArcadeStreamCanvas(canvas, game);
    return;
  }
  drawLegacyKioskCanvas(canvas, game);
}

function renderArcadeStream(game) {
  const gameView = document.getElementById('kiosk-game');
  const dashboard = document.getElementById('kiosk-dashboard');
  if (!game?.gameType) {
    gameView.hidden = true;
    dashboard.hidden = false;
    return;
  }
  dashboard.hidden = true;
  gameView.hidden = false;
  document.getElementById('kiosk-game-title').textContent = GAME_NAMES[game.gameType] || 'Arcade';
  document.getElementById('kiosk-game-status').textContent = game.phase === 'ended' ? 'Beendet' : game.phase === 'countdown' ? 'Startet gleich' : game.paused ? 'Pause' : 'Läuft';
  const content = document.getElementById('kiosk-game-content');
  if (game.gameType === 'quiz') {
    content.innerHTML = `<div class="kiosk-game-question">${escapeHtml(game.question || 'Nächste Frage kommt gleich.')}</div>`;
    return;
  }
  if (game.gameType === 'challenge-rush') {
    content.innerHTML = `<div class="kiosk-game-question">${escapeHtml(game.challenge || 'Mini-Challenge')}</div><div class="kiosk-game-scores">${(game.scores || []).map((score) => `<div>${escapeHtml(score.name || 'Spieler')}: <strong>${score.score || 0}</strong></div>`).join('')}</div>`;
    return;
  }
  let canvas = content.querySelector('canvas');
  if (!canvas) content.innerHTML = '';
  const legendHtml = snakeArenaLegendHtml(game);
  const existingLegend = content.querySelector('.snake-arena-legend');
  if (legendHtml && !existingLegend) content.insertAdjacentHTML('afterbegin', legendHtml);
  else if (legendHtml && existingLegend?.outerHTML !== legendHtml) existingLegend.outerHTML = legendHtml;
  else if (!legendHtml) existingLegend?.remove();
  if (!canvas) { content.insertAdjacentHTML('beforeend', '<canvas width="800" height="450" aria-label="Livebild des Arcade-Spiels"></canvas>'); canvas = content.querySelector('canvas'); }
  drawKioskCanvas(canvas, game);
}

async function ensureAccess() {
  const fromUrl = new URLSearchParams(location.search).get('token');
  if (fromUrl) setKioskToken(fromUrl);

  const token = getKioskToken();
  if (!token) return false;
  try {
    await api.live.board();
    if (fromUrl) history.replaceState(null, '', `${location.pathname}${location.hash}`);
    return true;
  } catch (err) {
    // Only a confirmed 401 (invalid/revoked token) means the stored credential
    // is actually bad. A network failure, timeout or transient 5xx (e.g. the
    // server restarting mid-deploy) must not wipe an otherwise valid kiosk
    // token that this unattended screen has no way to re-enter itself.
    if (err?.status === 401) setKioskToken('');
    return false;
  }
}

function renderKioskLogin() {
  const root = document.getElementById('kiosk-root');
  const account = new URLSearchParams(location.search).get('account') || '';
  root.innerHTML = `
    <main class="kiosk-login-screen">
      <form class="card stack kiosk-login-card" data-kiosk-login>
        <div class="kiosk-login-brand">
          <img src="/img/logo.svg" alt="" width="48" height="48" />
          <div>
            <h1>Broadcast</h1>
            <p class="muted">Mit dem Konto dieses LAN-Events anmelden.</p>
          </div>
        </div>
        <label>
          <span class="field-label is-required">Broadcast-Konto</span>
          <input name="username" type="text" autocomplete="username" maxlength="100" required value="${escapeHtml(account)}" />
        </label>
        <label>
          <span class="field-label is-required">Passwort</span>
          <input name="password" type="password" autocomplete="current-password" maxlength="200" required />
        </label>
        <p class="form-error" data-kiosk-login-error role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">Broadcast öffnen</button>
      </form>
    </main>`;

  const form = root.querySelector('[data-kiosk-login]');
  const error = root.querySelector('[data-kiosk-login-error]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    error.hidden = true;
    try {
      const data = new FormData(form);
      const result = await api.kiosk.login({
        username: String(data.get('username') || '').trim(),
        password: String(data.get('password') || ''),
      });
      setKioskToken(result.token);
      history.replaceState(null, '', `${location.pathname}${location.hash}`);
      location.reload();
    } catch (loginError) {
      error.textContent = loginError.message;
      error.hidden = false;
      submit.disabled = false;
    }
  });
}

// A LAN's live roster can run past what even a compact row fits on screen.
// Rather than clip it (the previous behaviour), this first tries to avoid
// the problem entirely by widening to more columns — only once even the
// widest layout can't show everyone at once do pages of the rest start to
// rotate. Both the column count and the page size are re-decided from
// scratch on every fresh roster (settleLiveLayout), not just shrunk once and
// left there: a roster that shrinks later (people going offline, the event
// ending) should loosen back up instead of keeping empty space reserved for
// a bigger crowd that isn't there any more.
const LIVE_MAX_COLUMNS = 3;
const LIVE_MIN_COLUMN_WIDTH = 240;
const LIVE_MIN_PAGE_SIZE = 6;
const LIVE_ROTATE_INTERVAL_MS = 6_000;
let liveAllPlayers = [];
let liveColumns = 1;
let livePageSize = null; // null = everyone fits at liveColumns, no paging
let livePageIndex = 0;
let liveRotationTimer = null;

function stopLiveRotation() {
  if (liveRotationTimer !== null) clearInterval(liveRotationTimer);
  liveRotationTimer = null;
}

function liveRowHtml(p) {
  return `<div class="kiosk-live-row">${avatarHtml(p, 24)}<span class="player-name">${escapeHtml(p.name)}</span><span class="badge badge-${p.state}">${stateLabel(p.state)}</span></div>`;
}

// A fresh innerHTML's scrollHeight/clientHeight can still reflect a layout
// pass from before the kiosk grid has settled into its final 100dvh-based
// size (seen in practice right after the very first load). Waiting two
// animation frames guarantees the browser has painted with the real layout
// before any of the settling helpers below measure it.
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function liveFits(container) {
  return container.scrollHeight <= container.clientHeight + 1;
}

function liveDotsHtml(totalPages, pageIndex) {
  if (totalPages <= 1) return '';
  return `<div class="kiosk-live-dots">${Array.from(
    { length: totalPages },
    (_, i) => `<span class="kiosk-live-dot${i === pageIndex ? ' is-active' : ''}"></span>`,
  ).join('')}</div>`;
}

// Shared by settleLiveLayout's measurement and renderLivePageContent's actual
// paint so they can never disagree: the dots row takes real vertical space,
// so a fit-check that measured only the grid (without dots) could settle on a
// page size that then overflows once the dots are appended for real, clipping
// the last row against the card's own overflow instead of paging it away.
function livePageHtml(items, totalPages, pageIndex) {
  return `<div class="kiosk-live-grid">${items.map(liveRowHtml).join('')}</div>${liveDotsHtml(totalPages, pageIndex)}`;
}

// Decides liveColumns and livePageSize for the current liveAllPlayers; does
// not paint the visible page itself (renderLivePageContent does that
// cheaply afterwards, including on every rotation tick, without repeating
// this measuring work).
// A socket 'connect' shortly after the initial load (or any other event
// that re-triggers refreshLive while a previous settle is still mid-loop)
// used to start a second, overlapping settleLiveLayout — two loops each
// re-rendering #kiosk-live and reading each other's intermediate, oversized
// candidates as if they were their own, settling on a column/page count
// that fit nothing real. This token lets a fresher call cut an older one
// off after its next await instead of racing it to the finish.
let liveSettleToken = 0;

async function settleLiveLayout() {
  const myToken = ++liveSettleToken;
  const container = document.getElementById('kiosk-live');
  const total = liveAllPlayers.length;
  // More columns only helps if each one still has room for an avatar, a
  // name and a status badge without the name getting squeezed to nothing
  // (seen in practice on the narrow end of the supported widths). Cap the
  // search at however many of that minimum width actually fit before ever
  // trying a column count that would collide name against badge.
  const maxColumns = Math.max(1, Math.min(LIVE_MAX_COLUMNS, Math.floor(container.clientWidth / LIVE_MIN_COLUMN_WIDTH)));

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    container.style.setProperty('--live-columns', String(columns));
    container.innerHTML = `<div class="kiosk-live-grid">${liveAllPlayers.map(liveRowHtml).join('')}</div>`;
    await nextFrame();
    if (myToken !== liveSettleToken) return false;
    if (liveFits(container)) {
      liveColumns = columns;
      livePageSize = null;
      return true;
    }
  }

  liveColumns = maxColumns;
  let pageSize = Math.max(LIVE_MIN_PAGE_SIZE, total - 3);
  for (;;) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    container.innerHTML = livePageHtml(liveAllPlayers.slice(0, pageSize), totalPages, 0);
    await nextFrame();
    if (myToken !== liveSettleToken) return false;
    if (liveFits(container) || pageSize <= 1) break;
    // LIVE_MIN_PAGE_SIZE is a soft floor: below it, pages get short enough
    // that rotation feels twitchy, so shrinking slows down to one row at a
    // time. But it must never win against actually fitting — a kiosk screen
    // short or narrow enough that even LIVE_MIN_PAGE_SIZE rows overflow this
    // card keeps shrinking past it rather than clipping the last row.
    pageSize = pageSize > LIVE_MIN_PAGE_SIZE ? Math.max(LIVE_MIN_PAGE_SIZE, pageSize - 3) : pageSize - 1;
  }
  livePageSize = pageSize;
  return true;
}

function renderLivePageContent() {
  const container = document.getElementById('kiosk-live');
  container.style.setProperty('--live-columns', String(liveColumns));
  if (livePageSize === null) {
    container.innerHTML = `<div class="kiosk-live-grid">${liveAllPlayers.map(liveRowHtml).join('')}</div>`;
    stopLiveRotation();
    return;
  }
  const totalPages = Math.max(1, Math.ceil(liveAllPlayers.length / livePageSize));
  if (livePageIndex >= totalPages) livePageIndex = 0;
  const items = liveAllPlayers.slice(livePageIndex * livePageSize, livePageIndex * livePageSize + livePageSize);
  container.innerHTML = livePageHtml(items, totalPages, livePageIndex);
  if (totalPages > 1) {
    if (liveRotationTimer === null) {
      liveRotationTimer = setInterval(() => {
        livePageIndex += 1;
        renderLivePageContent();
      }, LIVE_ROTATE_INTERVAL_MS);
    }
  } else {
    stopLiveRotation();
  }
}

async function renderLive(players) {
  if (players.length === 0) {
    stopLiveRotation();
    updateHtml('kiosk-live', emptyStateHtml('Noch keine Spieler.', { className: 'kiosk-empty-state' }));
    return;
  }
  liveAllPlayers = [...players].sort((a, b) => {
    const rankDiff = STATE_RANK[a.state] - STATE_RANK[b.state];
    return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name, 'de');
  });
  livePageIndex = 0;
  const settled = await settleLiveLayout();
  if (!settled) return; // superseded by a fresher call; that one will paint
  renderLivePageContent();
}

// Fixed Top 5 as an interim simplification, no longer settled/adaptive.
const LEADERBOARD_ROWS_VISIBLE = 5;

function leaderboardRowHtml(s, i) {
  return `
      <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
        <span class="lb-rank">${i + 1}</span>
        ${avatarHtml(s, 28)}
        <span style="flex:1;">${escapeHtml(s.name)}</span>
        <span class="lb-points">${s.points} P</span>
      </div>`;
}

function renderLeaderboard(standings) {
  const container = document.getElementById('kiosk-leaderboard');
  if (!standings || standings.length === 0) {
    container.innerHTML = emptyStateHtml('Noch keine Ergebnisse.', { className: 'kiosk-empty-state' });
    return;
  }
  const rows = standings.slice(0, LEADERBOARD_ROWS_VISIBLE).map(leaderboardRowHtml).join('');
  container.innerHTML = `<div class="kiosk-ranking-grid">${rows}</div>`;
}

function concealedGameLabel(gameId, round) {
  const seedText = `${round}:${gameId}`;
  let seed = 0;
  for (const character of seedText) seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  const length = 5 + (seed % 10);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let label = '';
  for (let index = 0; index < length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    label += alphabet[seed % alphabet.length];
  }
  return label;
}

function kioskVoteScore(vote, result) {
  return vote.mode === 'points' ? `${result.points} P` : `${result.votes} ${result.votes === 1 ? 'Stimme' : 'Stimmen'}`;
}

function renderKioskVoteRows(vote, { concealed = false, highlightLeading = true } = {}) {
  const scored = vote.results.filter((result) => result.score > 0);
  if (scored.length === 0) return emptyStateHtml('Noch keine Stimmen.', { className: 'kiosk-vote-empty kiosk-empty-state' });
  const maxScore = Math.max(...scored.map((result) => result.score));
  let previousScore = null;
  let rank = 0;
  const rows = scored.map((result, index) => {
    if (previousScore === null || result.score !== previousScore) rank = index + 1;
    previousScore = result.score;
    const highlighted = result.score === maxScore;
    const score = kioskVoteScore(vote, result);
    const gameName = concealed ? concealedGameLabel(result.gameId, vote.round) : escapeHtml(result.gameName);
    return `<div class="kiosk-vote-result ${highlighted && highlightLeading ? 'is-leading' : ''} ${concealed ? 'is-concealed' : ''}">
        <span class="lb-rank">${rank}</span>
        <strong ${concealed ? 'aria-label="Spiel verborgen"' : ''}>${gameName}</strong>
        <span class="lb-points">${score}</span>
      </div>`;
  });
  return `<div class="kiosk-vote-results">${rows.join('')}</div>`;
}

function renderKioskVoteWinners(vote) {
  const scored = vote.results.filter((result) => result.score > 0);
  const maxScore = Math.max(...scored.map((result) => result.score));
  const winners = scored.filter((result) => result.score === maxScore);
  if (winners.length === 0) return '';
  return `
    <div class="kiosk-vote-winner-section">
      <div class="section-title kiosk-vote-final-title">Gewinner</div>
      <div class="kiosk-vote-winner">
        <div class="kiosk-vote-winner-games">
          ${winners.map((winner) => `<strong>${escapeHtml(winner.gameName)}</strong>`).join('')}
        </div>
        <span class="lb-points">${kioskVoteScore(vote, winners[0])}</span>
      </div>
    </div>`;
}

// One column, read straight down, rows at their normal size: every scored
// result is rendered and fitVoteRows then drops the ones below the card's
// bottom edge. A taller screen shows more of the ranking instead of more
// empty space, and a shorter one never squeezes the row geometry or font.
let lastVotesHtml = '';

// Synchronous on purpose: the card height comes from the dashboard grid, not
// from these rows, so a forced layout read is already final and the
// overflowing rows never paint. The ResizeObserver below re-fits once the
// first real layout (or any later size change) settles.
function fitVoteRows() {
  const list = document.querySelector('#kiosk-votes .kiosk-vote-results');
  if (!list) return;
  const limit = list.getBoundingClientRect().bottom + 0.5;
  for (const row of [...list.children]) {
    if (row.getBoundingClientRect().bottom > limit) row.remove();
  }
}

function paintVotes(html) {
  lastVotesHtml = html;
  updateHtml('kiosk-votes', html);
  fitVoteRows();
}

// Fullscreen, a window resize or a TV switching resolution changes the card
// height without a new vote payload. Watching the card itself (not the
// window) re-fits the rows for every such change: the full list is painted
// again and fitVoteRows keeps as many as the new height holds.
let voteResizeTimer = null;
let voteCardHeight = 0;
const kioskVotesElement = document.getElementById('kiosk-votes');
const voteResizeObserver = new ResizeObserver(([entry]) => {
  const height = Math.round(entry.contentRect.height);
  if (height === voteCardHeight) return;
  voteCardHeight = height;
  clearTimeout(voteResizeTimer);
  voteResizeTimer = setTimeout(() => {
    if (!lastVotesHtml) return;
    document.getElementById('kiosk-votes').innerHTML = lastVotesHtml;
    fitVoteRows();
  }, 150);
});
if (kioskVotesElement) voteResizeObserver.observe(kioskVotesElement);

let voteDisplayTimer = null;

function clearVoteDisplayTimer() {
  if (voteDisplayTimer !== null) clearTimeout(voteDisplayTimer);
  voteDisplayTimer = null;
}

function scheduleVoteRefresh(at) {
  clearVoteDisplayTimer();
  voteDisplayTimer = setTimeout(() => {
    voteDisplayTimer = null;
    refreshAll();
  }, Math.max(0, at - Date.now()));
}

function renderVotes(votes) {
  const vote = votes?.current ?? null;
  if (vote) {
    clearVoteDisplayTimer();
  } else if (votes?.recentResult) {
    const result = votes.recentResult;
    const now = Date.now();
    if (now < result.revealAt) {
      const seconds = Math.max(1, Math.ceil((result.revealAt - now) / 1000));
      scheduleVoteRefresh(Math.min(result.revealAt, now + 1000));
      return `
        <div class="kiosk-vote-state kiosk-vote-countdown">
          <strong>Ergebnis in</strong>
          <div class="countdown-num-wrap kiosk-vote-countdown-number countdown-pop" aria-label="${seconds}">
            <span class="countdown-num countdown-num-glow" aria-hidden="true">${seconds}</span>
            <span class="countdown-num countdown-num-fill">${seconds}</span>
          </div>
        </div>`;
    }
    scheduleVoteRefresh(result.expiresAt);
    return `
      <div class="kiosk-vote-final">
        ${renderKioskVoteWinners(result)}
        <div class="kiosk-vote-final-header">
          <div class="section-title kiosk-vote-final-title">Ergebnis im Detail</div>
          <span class="muted">${result.title ? `${escapeHtml(result.title)} · ` : ''}${result.totalVoters} Teilnehmer</span>
        </div>
        ${renderKioskVoteRows(result, { highlightLeading: false })}
      </div>`;
  } else {
    clearVoteDisplayTimer();
  }
  if (!vote) {
    return emptyStateHtml('Noch keine Abstimmung.', { className: 'kiosk-vote-state kiosk-empty-state' });
  }
  const heading = vote.mode === 'single' ? 'Stichwahl läuft' : 'Abstimmung läuft';
  const eligibleVoters = Number.isFinite(vote.eligibleVoters) ? vote.eligibleVoters : vote.totalVoters;
  return `
    <div class="kiosk-vote-overview">
      <div class="kiosk-vote-header">
        <span>
          <strong>${heading}</strong>
          ${vote.title ? `<span class="muted">${escapeHtml(vote.title)}</span>` : ''}
        </span>
        <span class="badge badge-playing">${vote.totalVoters} / ${eligibleVoters} abgestimmt</span>
      </div>
      ${renderKioskVoteRows(vote, { concealed: true })}
    </div>`;
}


function tournamentStandingRow(name, standing, index, { compact = false } = {}) {
  return `
    <div class="kiosk-standing-row ${index === 0 ? 'rank-1' : ''}">
      <span class="lb-rank">${index + 1}</span>
      <strong>${name}</strong>
      ${compact ? '' : `<span class="muted">${standing.wins}S · ${standing.draws}U · ${standing.losses}N</span>`}
      <span class="lb-points">${standing.points} P</span>
    </div>`;
}

function renderTournament(t) {
  if (!t) return emptyStateHtml('Noch kein Turnier.', { className: 'kiosk-empty-state' });
  const teamsById = new Map(t.teams.map((team) => [team.id, team]));
  const teamName = (id) => (id ? escapeHtml(teamsById.get(id)?.name ?? 'TBD') : 'TBD');

  if (t.format === 'round_robin') {
    const rows = (t.standings || [])
      .map((s, i) => tournamentStandingRow(teamName(s.teamId), s, i))
      .join('');
    return `<div class="kiosk-tournament-overview kiosk-tournament-stage">
      <div class="kiosk-tournament-meta"><strong>${escapeHtml(t.gameName)}</strong><span class="badge">Liga</span></div>
      <div class="kiosk-tournament-standings-grid">${rows}</div>
    </div>`;
  }

  // group_knockout has two distinct phases mixed into one `matches` list
  // (group-stage rows and, once generated, knockout-bracket rows) — round
  // numbers restart per group and per stage, so the bracket logic below
  // would mix them up. Show group standings while the group stage is still
  // running, then fall through to the same bracket rendering once the
  // knockout bracket exists (filtered to just its own rows).
  const knockoutMatches = t.matches.filter((m) => m.stage === 'knockout');
  if (t.format === 'group_knockout' && knockoutMatches.length === 0) {
    const groupBlocks = (t.groups || [])
      .map((g) => {
        const rows = g.standings
          .map((s, i) => tournamentStandingRow(teamName(s.teamId), s, i, { compact: true }))
          .join('');
        return `<div class="kiosk-tournament-group"><strong>Gruppe ${g.groupIndex + 1}</strong>${rows}</div>`;
      })
      .join('');
    return `<div class="kiosk-tournament-overview kiosk-tournament-stage">
      <div class="kiosk-tournament-meta"><strong>${escapeHtml(t.gameName)}</strong><span class="badge">Gruppenphase</span></div>
      <div class="kiosk-tournament-group-grid">${groupBlocks}</div>
    </div>`;
  }
  const bracketMatches = t.format === 'group_knockout' ? knockoutMatches : t.matches;

  // Bracket: show whichever round still has an undecided-but-playable
  // match, or the final result if it's all done.
  const totalRounds = Math.max(...bracketMatches.map((m) => m.round));
  const currentRound =
    bracketMatches.find((m) => !m.isBye && m.teamAId && m.teamBId && !m.winnerTeamId)?.round ?? totalRounds;
  const rows = bracketMatches
    .filter((m) => m.round === currentRound)
    .map((m) => {
      if (m.isBye) {
        return `
          <div class="kiosk-match-card">
            <div class="kiosk-match-team is-winner"><strong>${teamName(m.winnerTeamId)}</strong><span class="badge badge-playing">Weiter</span></div>
            <div class="muted">Freilos</div>
          </div>`;
      }
      return `
        <div class="kiosk-match-card">
          <div class="kiosk-match-team ${m.winnerTeamId === m.teamAId ? 'is-winner' : ''}"><strong>${teamName(m.teamAId)}</strong>${m.winnerTeamId === m.teamAId ? '<span class="badge badge-playing">Sieger</span>' : ''}</div>
          <div class="kiosk-match-team ${m.winnerTeamId === m.teamBId ? 'is-winner' : ''}"><strong>${teamName(m.teamBId)}</strong>${m.winnerTeamId === m.teamBId ? '<span class="badge badge-playing">Sieger</span>' : ''}</div>
        </div>`;
    })
    .join('');
  return `<div class="kiosk-tournament-overview kiosk-tournament-bracket">
    <div class="kiosk-tournament-meta">
      <strong>${escapeHtml(t.gameName)}</strong>
      <span class="badge ${t.status === 'completed' ? 'badge-offline' : 'badge-playing'}">${t.status === 'completed' ? 'Beendet' : `Runde ${currentRound}/${totalRounds}`}</span>
    </div>
    <div class="kiosk-tournament-bracket-body"><div class="kiosk-match-grid">${rows}</div></div>
  </div>`;
}

// Last-push banner: shows whatever was most recently sent to (almost)
// everyone — a manual Durchsage, but just as much a new Sammelbestellung, an
// Arcade-Lobby opening, a new vote round, a tournament update, ... (every
// notifyPlayers() call is logged server-side, see push.ts — the server-side
// filter in getLastPushLogEntry() already excludes personally-targeted
// pushes like "dein Match ist bereit", which wouldn't mean anything to
// everyone glancing at a shared screen). Shows the newest still-active one,
// with timestamp; closed or expired topics fall back to an older applicable
// announcement instead of lingering. The shared content markup lives in
// pushFeed.js; this Kiosk version is not clickable.
let pushBannerExpiryTimer = null;
let pushRefreshVersion = 0;

async function refreshPushBanner() {
  const requestVersion = ++pushRefreshVersion;
  try {
    const current = await api.push.last();
    if (requestVersion !== pushRefreshVersion) return;
    renderBroadcastBanner(current.entry);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Kiosk push-banner refresh failed:', err);
  }
}

function renderBroadcastBanner(entry) {
  const el = document.getElementById('kiosk-broadcast');
  if (pushBannerExpiryTimer) clearTimeout(pushBannerExpiryTimer);
  pushBannerExpiryTimer = null;
  if (!entry) {
    el.hidden = true;
    updateAlertLayout();
    return;
  }
  if (entry.expiresAt) {
    const delay = Math.max(0, Math.min(entry.expiresAt - Date.now() + 50, 2_147_483_647));
    pushBannerExpiryTimer = setTimeout(refreshPushBanner, delay);
  }
  const createdAt = Number(entry.createdAt);
  const html = `${bannerContentHtml(entry)} <span class="kiosk-broadcast-time" data-created-at="${createdAt}">${broadcastAgeText(createdAt)}</span>`;
  if (el.innerHTML !== html) el.innerHTML = html;
  el.hidden = false;
  updateAlertLayout();
}

function updateAlertLayout() {
  const alerts = document.getElementById('kiosk-alerts');
  if (!alerts) return;
  alerts.hidden = document.getElementById('kiosk-broadcast')?.hidden !== false;
}

let kioskMusicSession = null;
let kioskMusicProgressFrame = null;
let kioskLocalPlayback = null;

function renderKioskLocalPlayback(element) {
  if (!kioskLocalPlayback) {
    element.hidden = true;
    if (element.dataset.renderKey !== 'local:hidden') {
      element.innerHTML = '';
      element.dataset.renderKey = 'local:hidden';
    }
    return;
  }
  const connectedPlayer = localSpotifyPlayerInfo();
  const action = connectedPlayer
    ? '<strong>Als Spotify-Gerät bereit</strong><span class="muted">Jam jetzt auf einem Handy oder im Respawn-Tab starten.</span>'
    : kioskLocalPlayback.ready
      ? '<strong>Ton über diesen Broadcast/TV</strong><span class="muted">Aktiviert den Browser als Spotify-Gerät; der Ton läuft über HDMI oder den gewählten Computer-Ausgang.</span><button type="button" class="btn btn-primary" id="kiosk-enable-local-playback">Broadcast-Ton aktivieren</button>'
      : `<strong>Browser-Wiedergabe freigeben</strong><span class="muted">${escapeHtml(kioskLocalPlayback.message || 'Spotify im lokalen Controller neu freigeben.')}</span><a class="btn btn-primary" href="${LOCAL_CONTROLLER_URL}" target="_blank" rel="noopener">Lokalen Controller öffnen</a>`;
  const renderKey = connectedPlayer
    ? `local:${connectedPlayer.deviceId}`
    : `local:${kioskLocalPlayback.ready}:${kioskLocalPlayback.playerName}:${kioskLocalPlayback.message || ''}`;
  if (element.dataset.renderKey === renderKey) {
    element.hidden = false;
    return;
  }
  element.innerHTML = `<span class="kiosk-music-local">${action}</span>`;
  element.hidden = false;
  element.dataset.renderKey = renderKey;

  element.querySelector('#kiosk-enable-local-playback')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Spotify wird verbunden…';
    try {
      await connectLocalSpotifyPlayer({ name: kioskLocalPlayback.playerName });
      renderKioskLocalPlayback(element);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Erneut versuchen';
      const status = element.querySelector('.muted');
      if (status) status.textContent = error.message;
    }
  });
}

function estimatedMusicProgress(session, now = Date.now()) {
  if (!session?.currentTrack) return 0;
  const elapsed = session.isPlaying && session.playbackUpdatedAt ? now - session.playbackUpdatedAt : 0;
  return Math.max(0, Math.min(Number(session.currentTrack.durationMs || 0), Number(session.progressMs || 0) + elapsed));
}

function musicDurationLabel(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function stabilizedMusicSession(nextSession) {
  if (!nextSession?.currentTrack) return nextSession;
  const now = Date.now();
  const incomingProgress = estimatedMusicProgress(nextSession, now);
  const sameTrack = kioskMusicSession?.currentTrack?.uri === nextSession.currentTrack.uri;
  const previousProgress = sameTrack ? estimatedMusicProgress(kioskMusicSession, now) : 0;
  return {
    ...nextSession,
    progressMs: sameTrack && nextSession.isPlaying
      ? Math.max(previousProgress, incomingProgress)
      : incomingProgress,
    playbackUpdatedAt: now,
  };
}

function updateMusicBarProgress() {
  const session = kioskMusicSession;
  const duration = Number(session?.currentTrack?.durationMs || 0);
  const bar = document.querySelector('.kiosk-music-progress > span');
  const time = document.querySelector('.kiosk-music-duration');
  if (!duration || !bar) return;
  const progress = estimatedMusicProgress(session);
  bar.style.transform = `scaleX(${progress / duration})`;
  if (time) time.textContent = `${musicDurationLabel(progress)} / ${musicDurationLabel(duration)}`;
}

function scheduleMusicBarProgress() {
  if (kioskMusicProgressFrame) cancelAnimationFrame(kioskMusicProgressFrame);
  kioskMusicProgressFrame = null;
  const update = () => {
    updateMusicBarProgress();
    if (kioskMusicSession?.isPlaying && kioskMusicSession.currentTrack) {
      kioskMusicProgressFrame = requestAnimationFrame(update);
    } else {
      kioskMusicProgressFrame = null;
    }
  };
  update();
}

function renderMusicBar(payload) {
  const element = document.getElementById('kiosk-music');
  const session = stabilizedMusicSession(payload?.session);
  kioskMusicSession = session ?? null;
  if (!session) {
    renderKioskLocalPlayback(element);
    return;
  }
  const track = session.currentTrack;
  const duration = Number(track?.durationMs || 0);
  const progress = estimatedMusicProgress(session);
  const request = (session.requests || []).find(
    (entry) => entry.status === 'playing' && entry.trackUri === track?.uri,
  );
  const needsBrowserRecovery = localSpotifySessionNeedsRecovery(
    session,
    kioskLocalPlayback,
    localSpotifyPlayerInfo(),
  );
  const renderKey = JSON.stringify({
    track: track?.uri ?? null,
    playing: session.isPlaying,
    device: session.deviceName,
    requester: request?.requestedByName ?? null,
    nextQueue: kioskMusicQueueKey(session),
    browserRecovery: needsBrowserRecovery,
  });
  const playbackHtml = track ? `
    <span class="kiosk-music-current">
      ${track.imageUrl ? `<img class="kiosk-music-cover" src="${escapeHtml(track.imageUrl)}" alt="" />` : `<span class="kiosk-music-cover kiosk-music-placeholder">${icon('music')}</span>`}
      <span class="kiosk-music-copy">
        <span class="muted">Jetzt läuft</span>
        <strong>${escapeHtml(track.name)}</strong>
        <span class="muted">${escapeHtml(track.artist)}${request ? ` · gewünscht von ${escapeHtml(request.requestedByName)}` : ''}</span>
      </span>
      <span class="kiosk-music-progress-row">
        <span class="kiosk-music-progress"><span style="transform:scaleX(${duration ? progress / duration : 0});"></span></span>
        <span class="muted kiosk-music-duration">${musicDurationLabel(progress)} / ${musicDurationLabel(duration)}</span>
      </span>
    </span>
    <span class="kiosk-music-next">${kioskMusicQueueHtml(session)}</span>` : `
      <span class="kiosk-music-current kiosk-music-empty"><span class="kiosk-music-cover kiosk-music-placeholder">${icon('music')}</span><span class="kiosk-music-copy"><strong>Jam aktiv</strong><span class="muted">Auf ${escapeHtml(session.deviceName)} läuft gerade kein Titel.</span></span></span>`;
  const recoveryHtml = needsBrowserRecovery ? `
    <span class="kiosk-music-local">
      <strong>Browser-Ton getrennt</strong>
      <span class="muted">Nach dem Neuladen muss der Broadcast einmal wieder mit dem laufenden Jam verbunden werden.</span>
      <button type="button" class="btn btn-primary" id="kiosk-recover-local-playback">Broadcast-Ton wiederherstellen</button>
    </span>` : '';
  const html = `${playbackHtml}${recoveryHtml}`;
  if (element.dataset.renderKey !== renderKey) {
    element.innerHTML = html;
    element.dataset.renderKey = renderKey;
    element.querySelector('#kiosk-recover-local-playback')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Spotify wird wieder verbunden…';
      try {
        const localPlayer = await connectLocalSpotifyPlayer({ name: kioskLocalPlayback.playerName });
        await api.music.recoverDevice(localPlayer.deviceId);
        await refreshMusic();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Erneut versuchen';
        const status = button.parentElement?.querySelector('.muted');
        if (status) status.textContent = error.message;
      }
    });
  }
  element.hidden = false;
  scheduleMusicBarProgress();
}

async function refreshMusic() {
  const requestVersion = nextRefreshVersion('music');
  try {
    const [music, browserPlayback] = await Promise.all([
      api.music.kiosk(),
      localSpotifyPlaybackStatus(),
    ]);
    if (!isLatestRefresh('music', requestVersion)) return;
    kioskLocalPlayback = browserPlayback;
    if (kioskLocalPlayback?.ready) void preloadSpotifyPlaybackSdk().catch(() => {});
    renderMusicBar(music);
  } catch (error) {
    // Music is optional; a Spotify outage must never disturb the four
    // primary kiosk cards.
    // eslint-disable-next-line no-console
    console.error('Kiosk music refresh failed:', error);
  }
}

function updateHtml(id, html) {
  const element = document.getElementById(id);
  if (element.innerHTML !== html) element.innerHTML = html;
}

function logRefreshFailure(scope, error) {
  // A kiosk has nobody to dismiss a toast; keep the last-known card and let
  // the next scoped signal retry it.
  // eslint-disable-next-line no-console
  console.error(`Kiosk ${scope} refresh failed:`, error);
}

const refreshVersions = new Map();

function nextRefreshVersion(scope) {
  const version = (refreshVersions.get(scope) ?? 0) + 1;
  refreshVersions.set(scope, version);
  return version;
}

function isLatestRefresh(scope, version) {
  return refreshVersions.get(scope) === version;
}

async function refreshLive() {
  const requestVersion = nextRefreshVersion('live');
  try {
    const live = await api.live.board();
    if (!isLatestRefresh('live', requestVersion)) return;
    await renderLive(live);
  } catch (error) {
    logRefreshFailure('live', error);
  }
}

async function refreshVotes() {
  const requestVersion = nextRefreshVersion('vote');
  try {
    const votes = await api.votes.kiosk();
    if (!isLatestRefresh('vote', requestVersion)) return;
    paintVotes(renderVotes(votes));
  } catch (error) {
    logRefreshFailure('vote', error);
  }
}

async function refreshLeaderboard() {
  const requestVersion = nextRefreshVersion('leaderboard');
  try {
    const leaderboard = await api.leaderboard.get();
    if (!isLatestRefresh('leaderboard', requestVersion)) return;
    renderLeaderboard(leaderboard.standings);
  } catch (error) {
    logRefreshFailure('leaderboard', error);
  }
}

async function refreshTournament() {
  const requestVersion = nextRefreshVersion('tournament');
  try {
    const tournaments = await api.tournaments.list();
    if (!isLatestRefresh('tournament', requestVersion)) return;
    const active = tournaments.find((t) => t.status === 'active') || tournaments[0] || null;
    updateHtml('kiosk-tournament-title', `${icon(domainIcon('tournaments'))} ${active ? escapeHtml(active.name) : 'Turnier'}`);
    if (active) {
      const detail = await api.tournaments.get(active.id);
      if (!isLatestRefresh('tournament', requestVersion)) return;
      updateHtml('kiosk-tournament', renderTournament(detail));
    } else {
      updateHtml('kiosk-tournament', emptyStateHtml('Noch kein Turnier.', { className: 'kiosk-empty-state' }));
    }
  } catch (err) {
    logRefreshFailure('tournament', err);
  }
}

// Sequential, not Promise.all: Live-Status settles its own layout by
// temporarily rendering an oversized candidate before measuring and
// shrinking back down (settleLiveLayout). Running refreshes concurrently let
// another card's render inflate the shared .kiosk-grid row's height right as
// Live-Status sampled its own clientHeight, leaving it settled on a column/
// page count that no longer fit once the row height dropped back down.
// The banner and music bar go first for the same reason: both sit above or
// below the grid and shrink how much height it actually gets, so Live-Status
// must not settle before those two have already claimed their share of it.
async function refreshAll() {
  await refreshPushBanner();
  await refreshMusic();
  await refreshLive();
  await refreshVotes();
  await refreshLeaderboard();
  await refreshTournament();
}

// Kiosk screens are set up once (someone opens the browser, maybe clicks
// through a fullscreen prompt) and then run unattended for days — there's
// no guarantee of a later user gesture to satisfy the browser's autoplay
// policy, so grab whatever the first interaction turns out to be and use
// it to unlock/resume the AudioContext, just in case someone does touch
// the screen before the first push comes in.
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
['click', 'keydown'].forEach((evt) => document.addEventListener(evt, ensureAudioCtx, { once: true }));

// Short two-note "ding-dong" chime, synthesized instead of shipped as an
// audio file — no extra asset, no licensing to think about, same sound on
// every kiosk. Wrapped in try/catch: a sound glitch (no audio device on the
// display, autoplay still blocked, …) must never break the banner itself.
function playPushSound() {
  try {
    const ctx = ensureAudioCtx();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const start = now + i * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.35);
    });
  } catch {
    // see comment above — never let this take the kiosk down
  }
}

// Weekday plus time: a LAN runs over several days, so "Samstag 13:19"
// answers the glance better than the time alone. Built from two parts
// because the combined de-DE format inserts a comma after the weekday.
// Ticking every few seconds keeps the minute change prompt without tying the
// update to the second boundary. The same tick ages the banner's
// "vor 5 Min." so it never shows a second, competing clock time.
const CLOCK_TICK_MS = 5_000;

function updateClock() {
  const clock = document.getElementById('kiosk-clock');
  if (!clock) return;
  const now = new Date();
  const weekday = now.toLocaleDateString('de-DE', { weekday: 'long' });
  const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  clock.textContent = `${weekday} ${time}`;
  updateBroadcastAge();
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function broadcastAgeText(createdAt, now = Date.now()) {
  const age = Math.max(0, now - createdAt);
  if (age < MINUTE_MS) return 'gerade eben';
  if (age < HOUR_MS) return `vor ${Math.floor(age / MINUTE_MS)} Min.`;
  if (age < DAY_MS) return `vor ${Math.floor(age / HOUR_MS)} Std.`;
  return `seit ${new Date(createdAt).toLocaleDateString('de-DE', { weekday: 'long' })}`;
}

function updateBroadcastAge() {
  const age = document.querySelector('#kiosk-broadcast .kiosk-broadcast-time');
  const createdAt = Number(age?.dataset.createdAt);
  if (!age || !Number.isFinite(createdAt)) return;
  const text = broadcastAgeText(createdAt);
  if (age.textContent !== text) age.textContent = text;
}

const CORNER_IDLE_HIDE_MS = 2000;
let cornerHideTimer = null;

function showCorner() {
  document.querySelector('.kiosk-corner')?.classList.remove('is-idle-hidden');
}

function scheduleCornerHide() {
  if (cornerHideTimer !== null) clearTimeout(cornerHideTimer);
  cornerHideTimer = setTimeout(() => {
    cornerHideTimer = null;
    document.querySelector('.kiosk-corner')?.classList.add('is-idle-hidden');
  }, CORNER_IDLE_HIDE_MS);
}

function stopCornerAutoHide() {
  if (cornerHideTimer !== null) clearTimeout(cornerHideTimer);
  cornerHideTimer = null;
  showCorner();
}

function onCornerMouseMove() {
  showCorner();
  scheduleCornerHide();
}

function wireFullscreenControl() {
  const button = document.getElementById('kiosk-fullscreen');
  if (!button) return;
  if (!document.fullscreenEnabled || typeof document.documentElement.requestFullscreen !== 'function') {
    button.hidden = true;
    return;
  }

  // Esc only ever leaves fullscreen (a browser default, no code needed for
  // that direction) — entering it still needs one explicit click, so the
  // button stays even though the rest of the header chrome is gone. Once
  // actually in fullscreen, the button only needs to exist for that one
  // click, so it fades out after a couple of idle seconds and only
  // reappears on mouse movement — a real "clean" fullscreen instead of a
  // control permanently floating over the dashboard.
  const update = () => {
    const active = document.fullscreenElement !== null;
    button.innerHTML = icon(active ? 'minimize' : 'maximize');
    const label = active ? 'Vollbild beenden' : 'Vollbild';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-pressed', String(active));
    if (active) {
      document.addEventListener('mousemove', onCornerMouseMove);
      scheduleCornerHide();
    } else {
      document.removeEventListener('mousemove', onCornerMouseMove);
      stopCornerAutoHide();
    }
  };

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      logRefreshFailure('fullscreen', error);
    } finally {
      button.disabled = false;
      update();
    }
  });
  document.addEventListener('fullscreenchange', update);
  update();
}

async function main() {
  const ok = await ensureAccess();
  if (!ok) {
    renderKioskLogin();
    return;
  }

  wireFullscreenControl();
  updateClock();
  setInterval(updateClock, CLOCK_TICK_MS);
  setInterval(refreshMusic, 5_000);
  setInterval(refreshAll, KIOSK_REFRESH_INTERVAL_MS);
  const socket = connectSocket({ kiosk: true });

  socket.on('arcade:kiosk:game', renderArcadeStream);
  socket.on('connect', () => {
    // Socket.IO creates a fresh server-side socket after every reconnect.
    // Replay Arcade state and refetch all REST-backed cards so changes made
    // while the display was offline cannot leave the kiosk stale.
    socket.emit('kiosk:subscribe');
    void refreshAll();
  });

  socket.on('live:changed', refreshLive);
  // A rename can affect every card that contains a player snapshot. Each
  // updater still patches only when its rendered HTML actually changed.
  socket.on('players:changed', async () => {
    // Sequential for the same reason as refreshAll above.
    await refreshLive();
    await refreshLeaderboard();
    await refreshTournament();
  });
  socket.on('votes:changed', refreshVotes);
  socket.on('events:changed', refreshVotes);
  socket.on('leaderboard:changed', refreshLeaderboard);
  socket.on('tournaments:changed', refreshTournament);
  socket.on('music:changed', refreshMusic);

  // Last-push banner: a big banner across the top of the shared screen — the
  // whole point of putting it on the kiosk is that people look up from their
  // own machines. It stays until superseded, resolved or expired.
  socket.on('push:sent', () => {
    // The persisted feed is authoritative. Fetching it avoids an older
    // in-flight response or burst of socket payloads replacing the newest
    // banner on the shared screen.
    void refreshPushBanner();
    playPushSound();
  });
  socket.on('push:changed', refreshPushBanner);

  await refreshAll();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  document.getElementById('kiosk-root').innerHTML = emptyStateHtml(`Fehler beim Start: ${err.message}`, {
    className: 'empty-state-kiosk-loading',
  });
});
