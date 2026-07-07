// Auswertungen (analytics) view: awards, longest sessions, multitasking,
// a raw "who played what when" session log, and a per-game concurrency
// chart. Reached via a button on the Rangliste view, not the main bottom
// nav — this is for browsing after the fact, not something needed mid-game.
//
// Data is fetched lazily on first render and cached in this module (not the
// shared `state`, since it's filtered by its own date range independent of
// the rest of the app) — loadData() fetches, then triggers a re-render.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { showToast } from '../toast.js';

let cache = null;
let loading = false;

function defaultFilters() {
  const to = Date.now();
  const from = to - 3 * 24 * 60 * 60 * 1000; // covers a typical LAN weekend
  return { from, to, concurrencyGameId: null, bucketMinutes: 60 };
}
let filters = defaultFilters();

function toDatetimeLocal(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadData(ctx) {
  loading = true;
  ctx.rerender();
  try {
    const params = { from: String(filters.from), to: String(filters.to) };
    const gameId = filters.concurrencyGameId || (state.games[0] && state.games[0].id) || null;
    const [overview, sessions, awards, concurrency] = await Promise.all([
      api.analytics.overview(params),
      api.analytics.sessions(params),
      api.analytics.awards(params),
      gameId
        ? api.analytics.concurrency({ ...params, gameId, bucketMinutes: String(filters.bucketMinutes) })
        : Promise.resolve(null),
    ]);
    cache = { overview, sessions, awards, concurrency, gameId };
  } catch (err) {
    showToast(err.message, { error: true });
    cache = { overview: null, sessions: [], awards: { awards: [] }, concurrency: null, gameId: null };
  } finally {
    loading = false;
    ctx.rerender();
  }
}

export function renderAnalytics(container, ctx) {
  if (cache === null && !loading) {
    loadData(ctx);
  }

  container.innerHTML = `
    <h1 class="view-title">📊 Auswertungen</h1>
    <div class="card stack">
      <div class="row">
        <input type="datetime-local" id="an-from" value="${toDatetimeLocal(filters.from)}" style="flex:1;" />
        <input type="datetime-local" id="an-to" value="${toDatetimeLocal(filters.to)}" style="flex:1;" />
      </div>
      <button type="button" class="btn btn-primary btn-block" id="an-apply">Zeitraum anwenden</button>
    </div>
    <div id="an-content">${loading || !cache ? `<div class="empty-state">Lädt…</div>` : renderContent()}</div>
  `;

  container.querySelector('#an-apply').addEventListener('click', () => {
    const fromVal = container.querySelector('#an-from').value;
    const toVal = container.querySelector('#an-to').value;
    if (fromVal) filters.from = new Date(fromVal).getTime();
    if (toVal) filters.to = new Date(toVal).getTime();
    cache = null;
    ctx.rerender();
  });

  if (!loading && cache) {
    wireContent(container, ctx);
  }
}

function renderContent() {
  const awards = cache.awards?.awards || [];
  const overview = cache.overview || {
    longestSessionsPerGame: [],
    simultaneousGameTime: [],
  };
  const sessions = cache.sessions || [];

  const awardsHtml = awards.length
    ? awards
        .map(
          (a) => `
        <div class="card">
          <div class="row-between">
            <span style="font-size:1.4rem;">${escapeHtml(a.emoji)}</span>
            <span class="lb-points">${escapeHtml(a.value)}</span>
          </div>
          <div class="player-name">${escapeHtml(a.title)}</div>
          <div class="muted" style="font-size:0.8rem;">${escapeHtml(a.description)}</div>
          <div class="row" style="margin-top:6px;">
            <span class="avatar-dot" style="background:${escapeHtml(a.playerColor)}"></span>
            <span>${escapeHtml(a.playerName)}</span>
          </div>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:20px;"><span class="emoji">🏅</span>Noch keine Awards in diesem Zeitraum.</div>`;

  const longestPerGameHtml = overview.longestSessionsPerGame.length
    ? overview.longestSessionsPerGame
        .map(
          (r) => `
        <div class="lb-row">
          <span class="avatar-dot" style="background:${escapeHtml(r.playerColor)}"></span>
          <span style="flex:1;">${escapeHtml(r.gameIcon)} ${escapeHtml(r.gameName)} — ${escapeHtml(r.playerName)}</span>
          <span class="lb-points">${escapeHtml(r.formatted)}</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:20px;">Keine Sessions in diesem Zeitraum.</div>`;

  const multitaskingHtml = overview.simultaneousGameTime.length
    ? overview.simultaneousGameTime
        .map(
          (r) => `
        <div class="lb-row">
          <span class="avatar-dot" style="background:${escapeHtml(r.playerColor)}"></span>
          <span style="flex:1;">${escapeHtml(r.playerName)} <span class="muted" style="font-size:0.78rem;">(max. ${r.maxSimultaneous} gleichzeitig)</span></span>
          <span class="lb-points">${escapeHtml(r.multiGameFormatted)}</span>
        </div>`
        )
        .join('')
    : `<div class="empty-state" style="padding:20px;">Niemand hatte mehrere Spiele gleichzeitig offen.</div>`;

  const gameOptions = state.games
    .map(
      (g) =>
        `<option value="${g.id}" ${g.id === cache.gameId ? 'selected' : ''}>${escapeHtml(g.icon)} ${escapeHtml(g.name)}</option>`
    )
    .join('');
  const concurrencyChart = renderConcurrencyChart(cache.concurrency);

  const sessionRows = sessions
    .slice(0, 100)
    .map(
      (s) => `
      <div class="lb-row">
        <span class="avatar-dot" style="background:${escapeHtml(s.playerColor)}"></span>
        <span style="flex:1;">
          ${escapeHtml(s.playerName)} — ${escapeHtml(s.gameIcon)} ${escapeHtml(s.gameName)}
          <div class="muted" style="font-size:0.75rem;">${formatDateTime(s.startedAt)} – ${s.endedAt ? formatDateTime(s.endedAt) : 'läuft noch'}</div>
        </span>
        <span class="lb-points">${escapeHtml(s.formatted)}</span>
      </div>`
    )
    .join('');

  return `
    <div class="section-title">🏅 Awards</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));">${awardsHtml}</div>

    <div class="section-title">🏃 Längste Einzelsession pro Spiel</div>
    <div class="card">${longestPerGameHtml}</div>

    <div class="section-title">🤹 Mehrere Spiele gleichzeitig offen</div>
    <div class="card">${multitaskingHtml}</div>

    <div class="section-title">📈 Belegung über die Zeit</div>
    <div class="card stack">
      <select id="an-concurrency-game">${gameOptions}</select>
      ${concurrencyChart}
    </div>

    <div class="section-title">🕒 Wer hat wann was gespielt</div>
    <div class="card">
      ${sessionRows || `<div class="empty-state" style="padding:20px;">Keine Sessions in diesem Zeitraum.</div>`}
    </div>
  `;
}

function renderConcurrencyChart(concurrency) {
  if (!concurrency || concurrency.buckets.length === 0) {
    return `<div class="empty-state" style="padding:20px;">Keine Daten für dieses Spiel im Zeitraum.</div>`;
  }
  const max = Math.max(1, ...concurrency.buckets.map((b) => b.count));
  const bars = concurrency.buckets
    .map((b) => {
      const heightPct = Math.round((b.count / max) * 100);
      const label = new Date(b.bucketStart).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `<div title="${escapeHtml(label)}: ${b.count} Spieler" style="flex:0 0 8px;height:${Math.max(2, heightPct)}%;background:var(--accent);border-radius:2px;"></div>`;
    })
    .join('');
  return `<div id="an-concurrency-chart" style="display:flex;align-items:flex-end;gap:2px;height:100px;overflow-x:auto;padding-bottom:2px;">${bars}</div>
    <div class="muted" style="font-size:0.75rem;">Höhe = Anzahl Spieler gleichzeitig · zum Wert hovern/antippen · nach rechts = neuer</div>`;
}

function wireContent(container, ctx) {
  // The chart can span many buckets (e.g. 72 for a 3-day range at hourly
  // resolution) and scrolls horizontally — default to showing the most
  // recent end rather than leaving it looking empty at scrollLeft=0 if all
  // the activity happened later in the range.
  const chart = container.querySelector('#an-concurrency-chart');
  if (chart) chart.scrollLeft = chart.scrollWidth;

  const select = container.querySelector('#an-concurrency-game');
  if (select) {
    select.addEventListener('change', (e) => {
      filters.concurrencyGameId = e.target.value;
      cache = null;
      ctx.rerender();
    });
  }
}
