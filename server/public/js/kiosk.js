// TV-/Kiosk dashboard: a read-only, auto-refreshing overview for a shared
// screen at the party (a monitor, a beamer) — nobody interacts with this,
// it just always shows current state. Reuses the same api.js/socket.js/
// format.js modules the main app uses, but renders its own compact layout
// rather than the phone-sized views (see kiosk.html/css).

import { api, getToken, setToken } from './api.js';
import { connectSocket } from './socket.js';
import { escapeHtml, stateLabel, avatarHtml, gameChipsHtml } from './format.js';

const STATE_RANK = { playing: 0, paused: 1, offline: 2 };

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
    return res.ok;
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
  return `<div class="stack" style="gap:8px;">${sorted
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
    return `<div class="muted" style="margin-bottom:6px;">${escapeHtml(t.gameIcon)} ${escapeHtml(t.gameName)} — Liga</div>${rows}`;
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
        return `<div class="muted" style="margin:6px 0 2px;">Gruppe ${g.groupIndex + 1}</div>${rows}`;
      })
      .join('');
    return `<div class="muted" style="margin-bottom:6px;">${escapeHtml(t.gameIcon)} ${escapeHtml(t.gameName)} — Gruppenphase</div>${groupBlocks}`;
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
  return `<div class="muted" style="margin-bottom:6px;">${escapeHtml(t.gameIcon)} ${escapeHtml(t.gameName)} — Runde ${currentRound}/${totalRounds}${t.status === 'completed' ? ' · Beendet 🏆' : ''}</div>${rows}`;
}

async function refreshAll() {
  try {
    const [live, votes, leaderboard, tournaments] = await Promise.all([
      api.live.board(),
      api.votes.get(),
      api.leaderboard.get(),
      api.tournaments.list(),
    ]);
    document.getElementById('kiosk-live').innerHTML = renderLive(live);
    document.getElementById('kiosk-votes').innerHTML = renderVotes(votes);
    document.getElementById('kiosk-leaderboard').innerHTML = renderLeaderboard(leaderboard.standings);

    const active = tournaments.find((t) => t.status === 'active') || tournaments[0] || null;
    document.getElementById('kiosk-tournament-title').textContent = active ? `🏟️ ${active.name}` : '🏟️ Turnier';
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
      <div class="empty-state" style="padding:60px;font-size:1.2rem;">
        Kein Zugriff — diese Seite mit <code>?token=…</code> öffnen (wie der Einladungslink).
      </div>`;
    return;
  }

  updateClock();
  setInterval(updateClock, 1000);
  await refreshAll();

  const socket = connectSocket();
  const dot = document.getElementById('kiosk-conn-dot');
  socket.on('connect', () => dot.classList.add('connected'));
  socket.on('disconnect', () => dot.classList.remove('connected'));

  ['live:changed', 'votes:changed', 'leaderboard:changed', 'tournaments:changed', 'matchmaking:generated'].forEach(
    (event) => socket.on(event, refreshAll)
  );

  // Durchsagen: a big banner across the top of the shared screen — the whole
  // point of announcing on the kiosk is that people look up from their own
  // machines. Stays up for a few minutes, newest message wins.
  let broadcastTimer = null;
  socket.on('broadcast:new', (payload) => {
    if (!payload) return;
    const banner = document.getElementById('kiosk-broadcast');
    banner.textContent = `📢 ${payload.playerName}: ${payload.message}`;
    banner.hidden = false;
    clearTimeout(broadcastTimer);
    broadcastTimer = setTimeout(() => {
      banner.hidden = true;
    }, 3 * 60 * 1000);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  document.getElementById('kiosk-root').innerHTML = `<div class="empty-state" style="padding:60px;">Fehler beim Start: ${err.message}</div>`;
});
