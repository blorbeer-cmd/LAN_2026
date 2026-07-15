// TV-/Kiosk dashboard: a read-only, auto-refreshing overview for a shared
// screen at the party (a monitor, a beamer) — nobody interacts with this,
// it just always shows current state. Reuses the same api.js/socket.js/
// format.js modules the main app uses, but renders its own compact layout
// rather than the phone-sized views (see kiosk.html/css).

import { api, getToken, setKioskMode, setToken } from './api.js';
import { connectSocket } from './socket.js';
import { escapeHtml, stateLabel, avatarHtml, gameChipsHtml, formatDateTime } from './format.js';
import { installIconReplacement, icon } from './icons.js';
import { bannerContentHtml } from './pushFeed.js';
import { drawArcadeStreamCanvas } from './arcadeStreamRenderer.js';

installIconReplacement();
setKioskMode(true);

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
  const protectedAccess = meta.authMode === 'required' ? meta.kioskProtection : meta.accessProtection;
  if (meta.authMode === 'required' && !meta.kioskProtection) return false;
  if (!protectedAccess) return true;

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
  return `<div class="stack" style="gap:var(--space-2);">${sorted
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

// While a round is open, the server withholds the per-game distribution
// (see votes.ts) so nobody — including everyone glancing at this shared
// screen — can see a leader emerge and bandwagon onto it. Just show that
// it's running and how many have participated so far; the full breakdown
// only ever appears once a round is closed (results.votes/points/score come
// back once that happens, but by then this card would need re-fetching
// mid-close to catch it, so we keep this simple: presence only, no bars).
function renderVotes(votes) {
  if (!votes || !votes.open) {
    return `<div class="empty-state">Keine offene Abstimmung.</div>`;
  }
  const label = votes.mode === 'points' ? `${votes.totalVoters} Teilnehmer bisher` : `${votes.totalVoters} Stimme(n) bisher`;
  return `
    <div class="empty-state">
      <span class="emoji">🗳️</span>
      Abstimmung läuft${votes.mode === 'points' ? ' (Punkte-Modus)' : ''}.<br />
      <span class="muted">${label} – Ergebnis erst nach dem Ende.</span>
    </div>`;
}

function renderLeaderboard(standings) {
  if (!standings || standings.length === 0) {
    return `<div class="empty-state">Noch keine Ergebnisse.</div>`;
  }
  return standings
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
}

function renderTournament(t) {
  if (!t) return `<div class="empty-state">Kein Turnier.</div>`;
  const teamsById = new Map(t.teams.map((team) => [team.id, team]));
  const teamName = (id) => (id ? escapeHtml(teamsById.get(id)?.name ?? 'TBD') : 'TBD');

  if (t.format === 'round_robin') {
    const rows = (t.standings || [])
      .map(
        (s, i) => `
        <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
          <span class="lb-rank">${i + 1}</span>
          <span style="flex:1;">${teamName(s.teamId)}</span>
          <span class="muted">${s.wins}S/${s.draws}U/${s.losses}N</span>
          <span class="lb-points">${s.points} P</span>
        </div>`
      )
      .join('');
    return `<div class="muted" style="margin-bottom:var(--space-2);">${escapeHtml(t.gameIcon)} ${escapeHtml(t.gameName)} — Liga</div>${rows}`;
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
          .map(
            (s, i) => `
            <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
              <span class="lb-rank">${i + 1}</span>
              <span style="flex:1;">${teamName(s.teamId)}</span>
              <span class="lb-points">${s.points} P</span>
            </div>`
          )
          .join('');
        return `<div class="muted" style="margin:var(--space-2) 0 var(--space-1);">Gruppe ${g.groupIndex + 1}</div>${rows}`;
      })
      .join('');
    return `<div class="muted" style="margin-bottom:var(--space-2);">${escapeHtml(t.gameIcon)} ${escapeHtml(t.gameName)} — Gruppenphase</div>${groupBlocks}`;
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
          <div class="lb-row">
            <span style="flex:1;">👑 ${teamName(m.winnerTeamId)} <span class="muted">(Freilos)</span></span>
          </div>`;
      }
      return `
        <div class="lb-row">
          <span style="flex:1;">
            ${m.winnerTeamId === m.teamAId ? '👑 ' : ''}${teamName(m.teamAId)}
            <span class="muted">vs</span>
            ${m.winnerTeamId === m.teamBId ? '👑 ' : ''}${teamName(m.teamBId)}
          </span>
        </div>`;
    })
    .join('');
  return `<div class="muted" style="margin-bottom:var(--space-2);">${escapeHtml(t.gameName)} — Runde ${currentRound}/${totalRounds}${t.status === 'completed' ? ' · Beendet 🏆' : ''}</div>${rows}`;
}

// Food-order banner: just enough for someone glancing at the shared screen
// to know an order is running and how to get in on it — when it goes out
// and where the menu/delivery link is. Never the item list or who ordered
// what (that's on everyone's own phone, in the Essen-bestellen view).
function renderFoodBanner(orders) {
  const open = (orders || []).filter((o) => o.open);
  const el = document.getElementById('kiosk-food-banner');
  if (open.length === 0) {
    el.hidden = true;
    return;
  }
  el.innerHTML = open
    .map((o) => {
      const when = o.sendAt ? `🕒 geht raus um ${formatDateTime(o.sendAt)} Uhr` : '🕒 Zeitpunkt noch offen';
      const where = o.link
        ? ` · <a href="${escapeHtml(o.link)}" target="_blank" rel="noopener">🔗 Zur Karte/Lieferdienst</a>`
        : '';
      return `<div>🍕 Sammelbestellung „${escapeHtml(o.title)}" läuft – ${when}${where}</div>`;
    })
    .join('');
  el.hidden = false;
}

// Last-push banner: shows whatever was most recently sent to (almost)
// everyone — a manual Durchsage, but just as much a new Sammelbestellung, an
// Arcade-Lobby opening, a new vote round, a tournament update, ... (every
// notifyPlayers() call is logged server-side, see push.ts — the server-side
// filter in getLastPushLogEntry() already excludes personally-targeted
// pushes like "dein Match ist bereit", which wouldn't mean anything to
// everyone glancing at a shared screen). Shows the newest still-active one,
// with timestamp; closed or expired topics fall back to an older applicable
// announcement instead of lingering. Same bell + title + body content as
// the app's
// header notification banner (see notificationBanner.js/pushFeed.js) —
// just not clickable, since the Kiosk has nobody to click it.
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
    return;
  }
  if (entry.expiresAt) {
    const delay = Math.max(0, Math.min(entry.expiresAt - Date.now() + 50, 2_147_483_647));
    pushBannerExpiryTimer = setTimeout(refreshPushBanner, delay);
  }
  el.innerHTML = `${bannerContentHtml(entry)} <span class="kiosk-broadcast-time">· ${formatDateTime(entry.createdAt)} Uhr</span>`;
  el.hidden = false;
}

async function refreshAll() {
  try {
    const [live, votes, leaderboard, tournaments, foodOrders, lastPush] = await Promise.all([
      api.live.board(),
      api.votes.get(),
      api.leaderboard.get(),
      api.tournaments.list(),
      api.foodOrders.list(),
      api.push.last(),
    ]);
    document.getElementById('kiosk-live').innerHTML = renderLive(live);
    document.getElementById('kiosk-votes').innerHTML = renderVotes(votes);
    document.getElementById('kiosk-leaderboard').innerHTML = renderLeaderboard(leaderboard.standings);
    renderFoodBanner(foodOrders.orders);
    renderBroadcastBanner(lastPush.entry);

    const active = tournaments.find((t) => t.status === 'active') || tournaments[0] || null;
    document.getElementById('kiosk-tournament-title').innerHTML = `${icon('swords')} ${active ? escapeHtml(active.name) : 'Turnier'}`;
    if (active) {
      const detail = await api.tournaments.get(active.id);
      document.getElementById('kiosk-tournament').innerHTML = renderTournament(detail);
    } else {
      document.getElementById('kiosk-tournament').innerHTML = `<div class="empty-state">Noch kein Turnier.</div>`;
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

  const socket = connectSocket({ kiosk: true });

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
