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

// This panel shares the existing tournament tile. Pages alternate with the
// tournament every ten seconds, and all participant rows eventually appear.
export function createKioskResultsPanel({ results, tournament, title }) {
  let feed = { showPoints: false, items: [] };
  let loaded = false;
  let failed = false;
  let showingResults = true;
  let tournamentTitle = 'Turnier';
  let hasTournament = false;
  let index = 0;
  let offset = 0;
  let nextOffset = 0;
  let payloadKey = '';

  function fit() {
    if (results.hidden) return;
    const rows = [...results.querySelectorAll('tbody tr')];
    if (!rows.length) return;
    rows.forEach((row) => {
      row.hidden = false;
    });
    results.classList.remove('is-compact');
    const footer = results.querySelector('.kiosk-result-pages');
    const total = resultRows(feed.items[index]).length;
    // Reserve the footer while measuring, even when the final page is short.
    footer.textContent = `${offset + 1}–${total} von ${total}`;
    const available = results.getBoundingClientRect().bottom - footer.getBoundingClientRect().height;
    if (rows[0].getBoundingClientRect().bottom > available) results.classList.add('is-compact');
    let count = rows.length;
    while (count > 1 && rows[count - 1].getBoundingClientRect().bottom > available) rows[--count].hidden = true;
    nextOffset = offset + count;
    footer.textContent = nextOffset < total || offset > 0 ? `${offset + 1}–${nextOffset} von ${total}` : '';
  }

  function render() {
    if (!feed.items.length) showingResults = !hasTournament;
    results.hidden = !showingResults;
    tournament.hidden = showingResults;
    title.innerHTML = `${icon(domainIcon('tournaments'))} ${escapeHtml(showingResults ? 'Ergebnisse' : tournamentTitle)}`;
    const item = feed.items[index];
    if (!item) {
      results.innerHTML = emptyStateHtml(
        failed ? 'Ergebnisse gerade nicht erreichbar.' : loaded ? 'Noch keine Ergebnisse.' : 'Lädt…',
        { className: 'kiosk-empty-state' },
      );
      return;
    }
    results.innerHTML = resultHtml(item, resultRows(item).slice(offset), feed.showPoints);
    fit();
  }

  function advance() {
    const item = feed.items[index];
    if (!item) return;
    if (nextOffset < resultRows(item).length) offset = nextOffset;
    else {
      index = (index + 1) % feed.items.length;
      offset = 0;
    }
  }

  const timer = setInterval(() => {
    if (!feed.items.length) return;
    if (showingResults) {
      advance();
      showingResults = !hasTournament;
    } else showingResults = true;
    render();
  }, PAGE_MS);
  const observer = new ResizeObserver(() => fit());
  observer.observe(results);
  render();

  return {
    update(payload) {
      const key = JSON.stringify(payload);
      loaded = true;
      failed = false;
      feed = { showPoints: payload.showPoints === true, items: Array.isArray(payload.items) ? payload.items : [] };
      if (key !== payloadKey) {
        payloadKey = key;
        index = 0;
        offset = 0;
        showingResults = true;
      }
      render();
    },
    setTournament(name, present) {
      tournamentTitle = name || 'Turnier';
      hasTournament = present;
      render();
    },
    hidePoints() {
      feed = { ...feed, showPoints: false };
      render();
    },
    error() {
      failed = true;
      feed = { ...feed, showPoints: false };
      render();
    },
    dispose() {
      clearInterval(timer);
      observer.disconnect();
    },
  };
}
