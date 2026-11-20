import { escapeHtml } from './format.js';
import { emptyStateHtml } from './emptyState.js';
import { icon } from './icons.js';
import { domainIcon } from './domainIcons.js';

const PAGE_MS = 10_000;

function resultRows(item) {
  return item.teams.flatMap((team, index) => {
    const label = team.name || (team.players.length > 1 ? `Team ${index + 1}` : '');
    const players = team.players.length ? team.players : [{ name: 'Keine Teilnehmerdaten' }];
    return players.map((player) => ({ ...player, place: team.place, team: label, winner: team.winner }));
  });
}

function resultHtml(item, rows, showPoints) {
  const date = new Date(item.activityAt);
  const validDate = Number.isFinite(date.getTime());
  const stamp = validDate
    ? date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'Zeitpunkt unbekannt';
  return `<div class="kiosk-result-page">
    <div class="kiosk-result-meta"><time${validDate ? ` datetime="${escapeHtml(date.toISOString())}"` : ''}>${escapeHtml(stamp)}</time>${item.draw || item.corrected ? `<span>${[item.draw ? 'Remis' : '', item.corrected ? 'korrigiert' : ''].filter(Boolean).join(' · ')}</span>` : ''}</div>
    <table class="kiosk-result-table" aria-label="${escapeHtml(item.gameName)}">
      <thead><tr><th scope="col">Platz</th><th scope="col">Spieler</th>${showPoints ? '<th scope="col" aria-label="Spielpunkte">Punkte</th>' : ''}</tr></thead>
      <tbody>${rows
        .map(
          (row) => `<tr${row.winner ? ' class="is-winner"' : ''}>
        <td>${escapeHtml(row.place)}.</td>
        <td><div class="kiosk-result-player"><span class="kiosk-result-name" title="${escapeHtml(row.team ? `${row.team} · ${row.name}` : row.name)}">${row.team ? `${escapeHtml(row.team)} · ` : ''}${escapeHtml(row.name)}</span>${row.winner ? '<span class="kiosk-result-win">Sieg</span>' : ''}</div></td>
        ${showPoints ? `<td>${Number.isSafeInteger(row.points) ? escapeHtml(row.points) : '–'}</td>` : ''}
      </tr>`,
        )
        .join('')}</tbody>
    </table>
    <div class="kiosk-result-pages"></div>
  </div>`;
}

function marketRows(item) {
  return item.outcomes.flatMap((outcome) => (outcome.tippers.length ? outcome.tippers : [null])
    .map((tipper) => ({ label: outcome.label, winner: outcome.winner, total: outcome.stake,
      count: outcome.tippers.length, name: tipper?.name ?? (tipper ? 'Anonym' : 'Noch keine Tipps'), stake: tipper?.stake })));
}

function pageCaption(page) {
  if (page.kind === 'result') return page.item.gameName;
  if (page.kind === 'ranking') return page.item.title;
  const { item } = page;
  return `${item.tournament.name} · ${item.sourceType === 'tournament' ? 'Turniersieger' : item.tournament.phase}`;
}

function rankingTableHtml(caption, rows) {
  return `<table class="kiosk-result-table kiosk-result-table--ranking" aria-label="${escapeHtml(caption)}">
      <thead><tr><th scope="col" aria-label="Rang">#</th><th scope="col">Spieler</th><th scope="col">Punkte</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.rank === null ? '–' : `${escapeHtml(row.rank)}.`}</td><td><span class="kiosk-result-name">${escapeHtml(row.name)}</span></td><td>${escapeHtml(row.points)}</td></tr>`).join('')}</tbody>
    </table>`;
}

// A ranking fills two columns, left first, with perColumn rows each.
function rankingHtml(page, rows, perColumn) {
  const caption = pageCaption(page);
  const columns = [rows.slice(0, perColumn), rows.slice(perColumn, perColumn * 2)].filter((column) => column.length);
  return `<div class="kiosk-result-page">
    <div class="kiosk-result-columns">${columns.map((column) => rankingTableHtml(caption, column)).join('')}</div>
    <div class="kiosk-result-pages"></div>
  </div>`;
}

function marketHtml(page, rows) {
  const { item } = page;
  const caption = pageCaption(page);
  const meta = `${item.status === 'settled' ? 'Abgerechnet' : item.status === 'open' ? 'Tipps offen' : 'Tipps geschlossen'} · Topf ${item.pot} P. · ${item.tipCount} Tipps`;
  return `<div class="kiosk-result-page">
    <div class="kiosk-result-meta">${escapeHtml(meta)}</div>
    <table class="kiosk-result-table kiosk-result-table--market" aria-label="${escapeHtml(caption)}">
      <thead><tr><th scope="col">Team</th><th scope="col">Tipps</th><th scope="col" aria-label="Einsatz in Punkten">P.</th></tr></thead>
      <tbody>${rows.map((row) => `<tr${row.winner ? ' class="is-winner"' : ''}><td><span class="kiosk-result-name">${escapeHtml(row.label)}</span>${row.winner ? '<span class="kiosk-result-win">Sieg</span>' : ''}<div class="kiosk-result-meta">${row.count} Tipps · ${row.total} P.</div></td><td><span class="kiosk-result-name">${escapeHtml(row.name)}</span></td><td>${row.stake === undefined ? '–' : `${row.stake} P.`}</td></tr>`).join('')}</tbody>
    </table><div class="kiosk-result-pages"></div>
  </div>`;
}

// All rows of results, markets and rankings rotate in the existing tile.
// The existing tournament view still alternates with each data page.
export function createKioskResultsPanel({ results, tournament, title }) {
  let feed = { showPoints: false, items: [] };
  let points = { showPoints: false, rounds: [], rankings: [] };
  let loaded = false;
  let failed = false;
  let showingResults = true;
  let tournamentTitle = 'Turnier';
  let hasTournament = false;
  let index = 0;
  let offset = 0;
  let nextOffset = 0;

  function pages() {
    return [
      ...feed.items.map((item) => ({ key: `result:${item.id}`, kind: 'result', item, rows: resultRows(item) })),
      ...(points.showPoints ? [
        ...points.rounds.map((item) => ({ key: `market:${item.id}`, kind: 'market', item, rows: marketRows(item) })),
        ...points.rankings.map((item) => ({ key: `ranking:${item.category}`, kind: 'ranking', item, rows: item.rows })),
      ] : []),
    ];
  }

  function pagesLabel(total, shown) {
    return shown < total || offset > 0 ? `${offset + 1}–${shown} von ${total}` : '';
  }

  // Rankings split their rows over two columns, so instead of hiding rows
  // from the bottom the per-column count shrinks until both columns fit.
  function fitRanking() {
    const page = pages()[index];
    const rows = page.rows.slice(offset);
    const total = page.rows.length;
    const overflows = () => {
      const footer = results.querySelector('.kiosk-result-pages');
      const available = results.getBoundingClientRect().bottom - footer.getBoundingClientRect().height;
      return [...results.querySelectorAll('tbody tr:last-child')].some((row) => row.getBoundingClientRect().bottom > available);
    };
    const paint = (perColumn) => {
      results.innerHTML = rankingHtml(page, rows, perColumn);
      const shown = offset + Math.min(rows.length, perColumn * 2);
      // Measure with the footer line present, like fit() does.
      results.querySelector('.kiosk-result-pages').textContent = `${offset + 1}–${shown} von ${total}`;
      return shown;
    };
    results.classList.remove('is-compact');
    let perColumn = Math.max(1, Math.ceil(rows.length / 2));
    let shown = paint(perColumn);
    while (perColumn > 1 && overflows()) {
      perColumn -= 1;
      shown = paint(perColumn);
    }
    if (overflows()) results.classList.add('is-compact');
    nextOffset = shown;
    results.querySelector('.kiosk-result-pages').textContent = pagesLabel(total, shown);
  }

  function fit() {
    if (results.hidden) return;
    if (pages()[index]?.kind === 'ranking') {
      fitRanking();
      return;
    }
    const rows = [...results.querySelectorAll('tbody tr')];
    if (!rows.length) return;
    rows.forEach((row) => { row.hidden = false; });
    results.classList.remove('is-compact');
    const footer = results.querySelector('.kiosk-result-pages');
    const total = pages()[index]?.rows.length ?? 0;
    footer.textContent = `${offset + 1}–${total} von ${total}`;
    const available = results.getBoundingClientRect().bottom - footer.getBoundingClientRect().height;
    if (rows[0].getBoundingClientRect().bottom > available) results.classList.add('is-compact');
    let count = rows.length;
    while (count > 1 && rows[count - 1].getBoundingClientRect().bottom > available) rows[--count].hidden = true;
    nextOffset = offset + count;
    footer.textContent = pagesLabel(total, nextOffset);
  }

  function render() {
    const list = pages();
    if (index >= list.length) { index = 0; offset = 0; }
    if (!list.length) showingResults = !hasTournament;
    results.hidden = !showingResults;
    tournament.hidden = showingResults;
    const page = list[index];
    const heading = page?.kind === 'ranking' ? 'LAN-Punkte' : page?.kind === 'market' ? 'Wetten' : 'Ergebnisse';
    // The page caption shares the heading line, right-aligned.
    const caption = showingResults && page ? `<span class="kiosk-result-caption">${escapeHtml(pageCaption(page))}</span>` : '';
    title.innerHTML = `${icon(domainIcon('tournaments'))} ${escapeHtml(showingResults ? heading : tournamentTitle)}${caption}`;
    if (!page) {
      results.innerHTML = emptyStateHtml(failed ? 'Ergebnisse gerade nicht erreichbar.' : loaded ? 'Noch keine Ergebnisse.' : 'Lädt…', { className: 'kiosk-empty-state' });
      return;
    }
    if (page.kind === 'ranking') {
      fitRanking();
      return;
    }
    results.innerHTML = page.kind === 'result'
      ? resultHtml(page.item, page.rows.slice(offset), feed.showPoints)
      : marketHtml(page, page.rows.slice(offset));
    fit();
  }

  const timer = setInterval(() => {
    const list = pages();
    if (!list.length) return;
    if (showingResults) {
      if (nextOffset < list[index].rows.length) offset = nextOffset;
      else { index = (index + 1) % list.length; offset = 0; }
      showingResults = !hasTournament;
    } else showingResults = true;
    render();
  }, PAGE_MS);
  const observer = new ResizeObserver(() => fit());
  observer.observe(results);
  render();

  // Refresh values without restarting the rotation. If a page disappears,
  // continue at its next surviving neighbour rather than starving later pages.
  function updatePages(change) {
    const before = pages();
    const currentKey = before[index]?.key;
    const neighbours = [...before.slice(index + 1), ...before.slice(0, index)].map((page) => page.key);
    change();
    const after = pages();
    let position = after.findIndex((page) => page.key === currentKey);
    if (position < 0) {
      const next = neighbours.find((key) => after.some((page) => page.key === key));
      position = after.findIndex((page) => page.key === next);
      offset = 0;
    }
    index = position < 0 ? Math.min(index, Math.max(0, after.length - 1)) : position;
    offset = Math.min(offset, Math.max(0, (after[index]?.rows.length ?? 0) - 1));
    render();
  }
  function reset() { index = 0; offset = 0; showingResults = true; }
  function hidePoints() {
    feed = { ...feed, showPoints: false };
    points = { showPoints: false, rounds: [], rankings: [] };
    reset();
    render();
  }
  return {
    update(payload) {
      loaded = true;
      failed = false;
      updatePages(() => {
        feed = { showPoints: payload.showPoints === true, items: Array.isArray(payload.items) ? payload.items : [] };
      });
    },
    updatePoints(payload) {
      if (payload.showPoints !== true) return hidePoints();
      updatePages(() => { points = payload; });
    },
    setTournament(name, present) { tournamentTitle = name || 'Turnier'; hasTournament = present; render(); },
    hidePoints,
    error() { failed = true; hidePoints(); },
    dispose() { clearInterval(timer); observer.disconnect(); },
  };
}
