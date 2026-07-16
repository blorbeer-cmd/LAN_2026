// TV-/Kiosk dashboard: a read-only, auto-refreshing overview for a shared
// screen at the party (a monitor, a beamer) — nobody interacts with this,
// it just always shows current state. Reuses the same api.js/socket.js/
// format.js modules the main app uses, but renders its own compact layout
// rather than the phone-sized views (see kiosk.html/css).

import { api, getToken, setToken } from './api.js';
import { connectSocket } from './socket.js';
import { escapeHtml, stateLabel, avatarHtml, gameChipsHtml, gameBadgeHtml, formatDateTime } from './format.js';
import { installIconReplacement, icon } from './icons.js';
import { bannerContentHtml } from './pushFeed.js';
import { drawArcadeStreamCanvas } from './arcadeStreamRenderer.js';
import { domainIcon, installDomainIcons } from './domainIcons.js';

installIconReplacement();
installDomainIcons();

const STATE_RANK = { playing: 0, paused: 1, offline: 2 };
const GAME_NAMES = { quiz: 'Gaming-Quiz', tetris: 'Tetris', scribble: 'Scribble', blobby: 'Blobby Volley', pong: 'Pong', snake: 'Snake' };
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
    const boardW = w / Math.max(1, boards.length);
    boards.forEach((player, index) => {
      const left = index * boardW + boardW * 0.1;
      const top = h * 0.06;
      const bw = boardW * 0.8;
      const bh = h * 0.88;
      const cell = Math.min(bw / 10, bh / 20);
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
      ctx.fillText(player.name || 'Spieler', left, h * 0.98);
    });
    return;
  }

  const world = game.world;
  if (!world) return;
  if (game.gameType === 'snake') {
    const cw = w / 32;
    const ch = h / 20;
    ctx.strokeStyle = cssColor('--accent-2');
    ctx.globalAlpha = 0.12;
    for (let x = 1; x < 32; x++) { ctx.beginPath(); ctx.moveTo(x * cw, 0); ctx.lineTo(x * cw, h); ctx.stroke(); }
    for (let y = 1; y < 20; y++) { ctx.beginPath(); ctx.moveTo(0, y * ch); ctx.lineTo(w, y * ch); ctx.stroke(); }
    ctx.globalAlpha = 1;
    world.snakes.forEach((snake, index) => { ctx.fillStyle = index ? cssColor('--accent-3') : cssColor('--accent'); snake.body.forEach((part) => ctx.fillRect(part.x * cw, part.y * ch, cw - 2, ch - 2)); });
    ctx.fillStyle = cssColor('--rank-1-gold'); ctx.beginPath(); ctx.arc((world.food.x + 0.5) * cw, (world.food.y + 0.5) * ch, Math.min(cw, ch) * 0.35, 0, Math.PI * 2); ctx.fill();
  } else if (game.gameType === 'pong') {
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
  document.getElementById('kiosk-game-status').textContent = game.phase === 'countdown' ? 'Startet gleich' : game.paused ? 'Pause' : 'Läuft';
  const content = document.getElementById('kiosk-game-content');
  if (game.gameType === 'quiz') {
    content.innerHTML = `<div class="kiosk-game-question">${escapeHtml(game.question || 'Nächste Frage kommt gleich.')}</div>`;
    return;
  }
  let canvas = content.querySelector('canvas');
  if (!canvas) { content.innerHTML = '<canvas width="800" height="450" aria-label="Livebild des Arcade-Spiels"></canvas>'; canvas = content.querySelector('canvas'); }
  drawKioskCanvas(canvas, game);
}

// Same idea as app.js's ensureAccess, but with no login form to fall back
// to — a kiosk screen is set up once (via ?token=…, same as an invite link)
// and then left running, so there's nobody there afterwards to type a token
// in if it's missing.
async function ensureAccess() {
  const meta = await api.meta();
  if (!meta.accessProtection) return true;

  const fromUrl = new URLSearchParams(location.search).get('token');
  if (fromUrl) setToken(fromUrl);

  const token = getToken();
  if (!token) return false;
  try {
    const res = await fetch('/api/health', { headers: { 'x-access-token': token } });
    if (!res.ok) return false;
    if (fromUrl) history.replaceState(null, '', `${location.pathname}${location.hash}`);
    return true;
  } catch {
    return false;
  }
}

function renderLive(players) {
  if (players.length === 0) {
    return `<div class="empty-state">Noch keine Spieler.</div>`;
  }
  const sorted = [...players].sort((a, b) => {
    const rankDiff = STATE_RANK[a.state] - STATE_RANK[b.state];
    return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name, 'de');
  });
  return `<div class="kiosk-live-grid">${sorted
    .map((p) => {
      const games = gameChipsHtml(p.games, p.activity_tracked, 18);
      return `
        <div class="card player-card">
          ${avatarHtml(p, 32)}
          <div class="player-card-main">
            <div class="row-between">
              <span class="player-name">${escapeHtml(p.name)}</span>
              <span class="badge badge-${p.state}">${stateLabel(p.state)}</span>
            </div>
            ${games ? `<div class="player-card-games chip-list">${games}</div>` : ''}
          </div>
        </div>`;
    })
    .join('')}</div>`;
}

function renderKioskVoteRows(vote) {
  const scored = vote.results.filter((result) => result.score > 0);
  if (scored.length === 0) return `<div class="muted kiosk-vote-empty">Noch keine Stimmen.</div>`;
  const maxScore = Math.max(...scored.map((result) => result.score));
  let previousScore = null;
  let rank = 0;
  return `<div class="kiosk-vote-results">${scored
    .slice(0, 6)
    .map((result, index) => {
      if (previousScore === null || result.score !== previousScore) rank = index + 1;
      previousScore = result.score;
      const highlighted = result.score === maxScore;
      const score = vote.mode === 'points' ? `${result.points} P` : `${result.votes} ${result.votes === 1 ? 'Stimme' : 'Stimmen'}`;
      return `<div class="kiosk-vote-result ${highlighted ? 'is-leading' : ''}">
        <span class="lb-rank">${rank}</span>
        ${gameBadgeHtml({ id: result.gameId, icon: result.icon }, 24)}
        <strong>${escapeHtml(result.gameName)}</strong>
        <span class="lb-points">${score}</span>
      </div>`;
    })
    .join('')}</div>`;
}

function renderVotes(votes) {
  const vote = votes?.current ?? null;
  if (!vote) {
    return `<div class="empty-state kiosk-vote-state">Keine offene Abstimmung.</div>`;
  }
  const heading = vote.mode === 'single' ? 'Stichwahl läuft' : 'Abstimmung läuft';
  return `
    <div class="kiosk-vote-overview">
      <div class="kiosk-vote-header">
        <span>
          <strong>${heading}</strong>
          ${vote.title ? `<span class="muted">${escapeHtml(vote.title)}</span>` : ''}
        </span>
        <span class="badge badge-playing">${vote.totalVoters} Teilnehmer</span>
      </div>
      <div class="section-title kiosk-vote-section-title">Zwischenstand</div>
      ${renderKioskVoteRows(vote)}
    </div>`;
}

function renderLeaderboard(standings) {
  if (!standings || standings.length === 0) {
    return `<div class="empty-state">Noch keine Ergebnisse.</div>`;
  }
  const rows = standings
    .slice(0, 8)
    .map(
      (s, i) => `
      <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
        <span class="lb-rank">${i + 1}</span>
        ${avatarHtml(s, 28)}
        <span style="flex:1;">${escapeHtml(s.name)}</span>
        <span class="lb-points">${s.points} P</span>
      </div>`
    )
    .join('');
  return `<div class="kiosk-ranking-grid">${rows}</div>`;
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
  if (!t) return `<div class="empty-state">Kein Turnier.</div>`;
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

async function refreshPushBanner() {
  try {
    const current = await api.push.last();
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
  el.innerHTML = `${bannerContentHtml(entry)} <span class="kiosk-broadcast-time">${formatDateTime(entry.createdAt)} Uhr</span>`;
  el.hidden = false;
  updateAlertLayout();
}

function updateAlertLayout() {
  const alerts = document.getElementById('kiosk-alerts');
  if (!alerts) return;
  alerts.hidden = document.getElementById('kiosk-broadcast')?.hidden !== false;
}

async function refreshAll() {
  try {
    const [live, votes, leaderboard, tournaments, lastPush] = await Promise.all([
      api.live.board(),
      api.votes.kiosk(),
      api.leaderboard.get(),
      api.tournaments.list(),
      api.push.last(),
    ]);
    document.getElementById('kiosk-live').innerHTML = renderLive(live);
    document.getElementById('kiosk-votes').innerHTML = renderVotes(votes);
    document.getElementById('kiosk-leaderboard').innerHTML = renderLeaderboard(leaderboard.standings);
    renderBroadcastBanner(lastPush.entry);

    const active = tournaments.find((t) => t.status === 'active') || tournaments[0] || null;
    document.getElementById('kiosk-tournament-title').innerHTML = `${icon(domainIcon('tournaments'))} ${active ? escapeHtml(active.name) : 'Turnier'}`;
    if (active) {
      const detail = await api.tournaments.get(active.id);
      document.getElementById('kiosk-tournament').innerHTML = renderTournament(detail);
    } else {
      document.getElementById('kiosk-tournament').innerHTML = `<div class="empty-state">Kein offenes Turnier.</div>`;
    }
  } catch (err) {
    // A kiosk screen has nobody to dismiss a toast — log and try again on
    // the next event/poll instead of leaving a stuck error state.
    // eslint-disable-next-line no-console
    console.error('Kiosk refresh failed:', err);
  }
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

function updateClock() {
  document.getElementById('kiosk-clock').textContent = new Date().toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function main() {
  const ok = await ensureAccess();
  if (!ok) {
    document.getElementById('kiosk-root').innerHTML = `
      <div class="empty-state" style="padding:var(--space-8);font-size:var(--font-size-lg);">
        Kein Zugriff — diese Seite mit <code>?token=…</code> öffnen (wie der Einladungslink).
      </div>`;
    return;
  }

  updateClock();
  setInterval(updateClock, 1000);
  await refreshAll();

  const socket = connectSocket();

  socket.on('arcade:kiosk:game', renderArcadeStream);
  socket.emit('kiosk:subscribe');

  [
    'live:changed',
    'votes:changed',
    'leaderboard:changed',
    'tournaments:changed',
    'matchmaking:generated',
    'foodOrders:changed',
  ].forEach((event) => socket.on(event, refreshAll));

  // Last-push banner: a big banner across the top of the shared screen — the
  // whole point of putting it on the kiosk is that people look up from their
  // own machines. It stays until superseded, resolved or expired.
  socket.on('push:sent', (payload) => {
    renderBroadcastBanner(payload);
    playPushSound();
  });
  socket.on('push:changed', refreshPushBanner);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  document.getElementById('kiosk-root').innerHTML = `<div class="empty-state" style="padding:var(--space-8);">Fehler beim Start: ${err.message}</div>`;
});
