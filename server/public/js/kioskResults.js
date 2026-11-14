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
    <div class="kiosk-result-caption">${escapeHtml(item.gameName)}</div>
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

function pointsHtml(page, rows) {
  const ranking = page.kind === 'ranking';
  const item = page.item;
  const caption = ranking ? `LAN-Punkte · ${item.title}`
    : `${item.tournament.name} · ${item.sourceType === 'tournament' ? 'Turniersieger' : item.tournament.phase}`;
  const meta = ranking ? 'Aktueller Stand' : `${item.status === 'settled' ? 'Abgerechnet' : item.status === 'open' ? 'Tipps offen' : 'Tipps geschlossen'} · Topf ${item.pot} P. · ${item.tipCount} Tipps`;
  return `<div class="kiosk-result-page">
    <div class="kiosk-result-caption">${escapeHtml(caption)}</div>
    <div class="kiosk-result-meta">${escapeHtml(meta)}</div>
    <table class="kiosk-result-table${ranking ? '' : ' kiosk-result-table--market'}" aria-label="${escapeHtml(caption)}">
      <thead><tr>${ranking ? '<th scope="col">Platz</th><th scope="col">Spieler</th><th scope="col">Punkte</th>' + (item.category === 'total' ? '' : '<th scope="col">Platzpunkte</th>') : '<th scope="col">Team</th><th scope="col">Tipps</th><th scope="col">Einsatz</th>'}</tr></thead>
      <tbody>${rows.map((row) => ranking
        ? `<tr><td>${row.rank === null ? '–' : `${escapeHtml(row.rank)}.`}</td><td><span class="kiosk-result-name">${escapeHtml(row.name)}</span></td><td>${escapeHtml(row.points)}</td>${item.category === 'total' ? '' : `<td>${escapeHtml(row.placePoints)}</td>`}</tr>`
        : `<tr${row.winner ? ' class="is-winner"' : ''}><td><span class="kiosk-result-name">${escapeHtml(row.label)}</span>${row.winner ? '<span class="kiosk-result-win">Sieg</span>' : ''}<div class="kiosk-result-meta">${row.count} Tipps · ${row.total} P.</div></td><td><span class="kiosk-result-name">${escapeHtml(row.name)}</span></td><td>${row.stake === undefined ? '–' : `${row.stake} P.`}</td></tr>`).join('')}</tbody>
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
  let payloadKey = '';
  let pointsKey = '';

  function pages() {
    return [
      ...feed.items.map((item) => ({ kind: 'result', item, rows: resultRows(item) })),
      ...(points.showPoints ? [
        ...points.rounds.map((item) => ({ kind: 'market', item, rows: marketRows(item) })),
        ...points.rankings.map((item) => ({ kind: 'ranking', item, rows: item.rows })),
      ] : []),
    ];
  }

  function fit() {
    if (results.hidden) return;
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
    footer.textContent = nextOffset < total || offset > 0 ? `${offset + 1}–${nextOffset} von ${total}` : '';
  }

  function render() {
    const list = pages();
    if (index >= list.length) { index = 0; offset = 0; }
    if (!list.length) showingResults = !hasTournament;
    results.hidden = !showingResults;
    tournament.hidden = showingResults;
    const page = list[index];
    const heading = page?.kind === 'ranking' ? `LAN-Punkte · ${page.item.title}` : page?.kind === 'market' ? 'Wetten' : 'Ergebnisse';
    title.innerHTML = `${icon(domainIcon('tournaments'))} ${escapeHtml(showingResults ? heading : tournamentTitle)}`;
    if (!page) {
      results.innerHTML = emptyStateHtml(failed ? 'Ergebnisse gerade nicht erreichbar.' : loaded ? 'Noch keine Ergebnisse.' : 'Lädt…', { className: 'kiosk-empty-state' });
      return;
    }
    results.innerHTML = page.kind === 'result'
      ? resultHtml(page.item, page.rows.slice(offset), feed.showPoints)
      : pointsHtml(page, page.rows.slice(offset));
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

  function reset() { index = 0; offset = 0; showingResults = true; }
  function hidePoints() {
    feed = { ...feed, showPoints: false };
    points = { showPoints: false, rounds: [], rankings: [] };
    pointsKey = '';
    reset();
    render();
  }
  return {
    update(payload) {
      const key = JSON.stringify(payload);
      loaded = true;
      failed = false;
      feed = { showPoints: payload.showPoints === true, items: Array.isArray(payload.items) ? payload.items : [] };
      if (key !== payloadKey) { payloadKey = key; reset(); }
      render();
    },
    updatePoints(payload) {
      const key = JSON.stringify(payload);
      points = payload.showPoints === true ? payload : { showPoints: false, rounds: [], rankings: [] };
      if (key !== pointsKey) { pointsKey = key; reset(); }
      render();
    },
    setTournament(name, present) { tournamentTitle = name || 'Turnier'; hasTournament = present; render(); },
    hidePoints,
    error() { failed = true; hidePoints(); },
    dispose() { clearInterval(timer); observer.disconnect(); },
  };
}
