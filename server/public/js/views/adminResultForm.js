import { api } from '../api.js';
import { state, catalogGames } from '../state.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';
import { selectionSearchHtml, wireSelectionSearch } from '../selectionSearch.js';
import { resultFormHtml, resultRanks, resultWinnerIndex, wireResultForm } from '../resultDialog.js';

// The free Admin match keeps its own game and participant setup. Its result
// choices and score rows are the same component used by Match and tournaments.
export function openMatchForm(ctx) {
  const games = catalogGames();
  if (!games.length || state.players.length < 2) {
    showToast('Dafür braucht es mindestens ein Spiel im Katalog und 2 Spieler.', { error: true });
    return;
  }
  const gameOptions = games.map((game) => ({ value: game.id, label: game.name }));
  const selectedGameId = games.some((game) => game.id === state.selectedGameId) ? state.selectedGameId : games[0].id;
  let teamCount = 2;
  let isFfa = false;
  let mode = 'winner';
  let dirty = false;
  const assignment = new Map();
  const scoresByKey = new Map();
  let winnerKey = null;
  let displayedKeys = [];
  let playerQuery = '';
  let ffaIds = new Set(state.live.filter((player) => player.state === 'playing').map((player) => player.player_id));
  if (!ffaIds.size) ffaIds = new Set(state.players.map((player) => player.id));

  // One flat form like the Match result and tournament dialogs: game and team
  // count share the first line, then players and result follow under plain
  // subheadings and a hairline, without nested cards or accent rails.
  const { el, close } = openModal('Ergebnis eintragen', `
    <div class="stack" id="match-form">
      <div class="match-form-head">
        <div><label class="field-label" for="match-game-search">Spiel</label>
          ${searchSelectHtml('match-game', gameOptions, selectedGameId, { placeholder: 'Spiel suchen' })}</div>
        <div class="match-team-count-field"><label class="field-label" for="match-teamcount">Teams</label>
          <input type="number" id="match-teamcount" min="2" max="6" value="${teamCount}" /></div>
      </div>
      <div><label class="check-row"><input type="checkbox" id="match-ffa" /><span>Frei-für-alle</span></label></div>
      <div id="match-body"></div>
    </div>`, {
    confirmClose: () => dirty ? 'Die Teamzuordnung und das eingetragene Ergebnis gehen verloren.' : null,
    // Two columns of players need the wider panel from --bp-lg.
    onMount: (backdrop) => backdrop.classList.add('match-form-modal'),
  });
  wireSearchSelect(el, 'match-game', gameOptions);
  // Typing a player search changes nothing worth confirming on close.
  const markDirty = (event) => { if (event.target.id !== 'match-player-search') dirty = true; };
  el.querySelector('#match-form').addEventListener('input', markDirty);
  el.querySelector('#match-form').addEventListener('change', markDirty);
  const body = el.querySelector('#match-body');

  function teamEntries() {
    if (isFfa) return state.players.filter((player) => ffaIds.has(player.id)).map((player) => ({
      name: player.name, players: [], playerIds: [player.id],
    }));
    return Array.from({ length: teamCount }, (_, index) => ({
      name: `Team ${index + 1}`,
      playerIds: state.players.filter((player) => assignment.get(player.id) === index).map((player) => player.id),
      players: state.players.filter((player) => assignment.get(player.id) === index).map((player) => player.name),
    }));
  }

  function rememberResult() {
    const current = body.querySelector('#match-result-entry');
    if (!current) return;
    displayedKeys.forEach((key, index) => {
      scoresByKey.set(key, current.querySelector(`[data-result-score="${index}"]`)?.value ?? '');
    });
    const selected = current.querySelector('input[type="radio"]:checked');
    if (selected) winnerKey = selected.value === '-1' ? 'draw' : displayedKeys[Number(selected.value)];
  }

  function renderResult() {
    rememberResult();
    const entries = teamEntries();
    displayedKeys = entries.map((entry, index) => isFfa ? `player:${entry.playerIds[0]}` : `team:${index}`);
    const winnerIndex = winnerKey === 'draw' ? -1 : displayedKeys.indexOf(winnerKey);
    const result = body.querySelector('#match-result-entry');
    result.innerHTML = resultFormHtml({
      teams: entries,
      prefix: 'admin-result',
      mode,
      scores: displayedKeys.map((key) => scoresByKey.get(key) ?? ''),
      winnerIndex: winnerIndex >= 0 || winnerKey === 'draw' ? winnerIndex : undefined,
    });
    wireResultForm(result, {
      teams: entries, mode,
      onModeChange: (value) => { mode = value; },
      onSave: async ({ mode: savedMode, scores, winnerIndex: selectedWinner }) => {
        const selected = entries.map((entry, index) => ({ ...entry, score: scores[index], sourceIndex: index }))
          .filter((entry) => entry.playerIds.length > 0);
        if (selected.length < 2) throw new Error(isFfa ? 'Mindestens 2 Teilnehmer auswählen.' : 'Mindestens 2 Teams müssen Spieler enthalten.');
        let resolvedWinner;
        let ranks = selected.map(() => null);
        if (savedMode === 'score') {
          const activeScores = selected.map((entry) => entry.score);
          ranks = resultRanks(activeScores);
          resolvedWinner = resultWinnerIndex(activeScores);
        } else {
          resolvedWinner = selectedWinner === null ? null : selected.findIndex((entry) => entry.sourceIndex === selectedWinner);
          if (resolvedWinner === -1) throw new Error('Das Gewinner-Team hat keine Spieler zugeordnet.');
        }
        await api.matches.create({
          gameId: el.querySelector('#match-game').value,
          teams: selected.map((entry, index) => ({
            playerIds: entry.playerIds,
            score: savedMode === 'score' ? entry.score : null,
            rank: savedMode === 'score' ? ranks[index] : null,
          })),
          winnerTeamIndex: resolvedWinner,
        });
        close();
        await ctx.refresh();
        showToast('Ergebnis gespeichert.');
      },
    });
  }

  function participantSummary() {
    if (isFfa) return `${ffaIds.size} dabei`;
    return `${assignment.size} von ${state.players.length} zugeordnet`;
  }

  function renderBody() {
    rememberResult();
    const teamCountInput = el.querySelector('#match-teamcount');
    teamCountInput.disabled = isFfa;
    const rows = isFfa
      ? state.players.map((player) => `<label class="check-row" data-selection-search="${escapeHtml(player.name)}">
          <input type="checkbox" data-ffa-player="${escapeHtml(player.id)}" ${ffaIds.has(player.id) ? 'checked' : ''} />
          ${avatarHtml(player, 20)}<span class="player-name match-player-name">${escapeHtml(player.name)}</span>
        </label>`)
      : state.players.map((player) => `<div class="player-assignment-row match-player-row" data-selection-search="${escapeHtml(player.name)}">
          ${avatarHtml(player, 20)}<span class="player-name match-player-name">${escapeHtml(player.name)}</span>
          <select data-team-for="${escapeHtml(player.id)}" aria-label="Team für ${escapeHtml(player.name)}">
            <option value="" ${assignment.has(player.id) ? '' : 'selected'}>–</option>
            ${Array.from({ length: teamCount }, (_, index) => `<option value="${index}" ${assignment.get(player.id) === index ? 'selected' : ''}>Team ${index + 1}</option>`).join('')}
          </select></div>`);
    body.innerHTML = `<div class="stack">
      <section class="stack match-form-section" aria-labelledby="match-players-title">
        <h3 class="section-title match-form-subtitle" id="match-players-title">${isFfa ? 'Teilnehmende' : 'Spieler'}
          <span class="muted" data-match-participant-summary>${participantSummary()}</span></h3>
        ${selectionSearchHtml('match-player-search', playerQuery)}
        <div id="${isFfa ? 'match-ffa-players' : 'match-players'}" class="match-player-grid" style="--match-player-rows:${Math.ceil(rows.length / 2)}">${rows.join('')}</div>
        <div class="muted match-player-empty" data-match-player-empty hidden>Kein Spieler gefunden</div>
      </section>
      <section class="stack match-form-section" aria-labelledby="match-result-title">
        <h3 class="section-title match-form-subtitle" id="match-result-title">Ergebnis</h3>
        <div id="match-result-entry"></div>
      </section></div>`;
    renderResult();
    wireSelectionSearch(body, {
      inputId: 'match-player-search',
      itemSelector: '[data-selection-search]',
      emptySelector: '[data-match-player-empty]',
      onQueryChange: (value) => { playerQuery = value; },
    });
    const updateSummary = () => {
      body.querySelector('[data-match-participant-summary]').textContent = participantSummary();
    };
    body.querySelectorAll('[data-team-for]').forEach((select) => select.addEventListener('change', () => {
      if (select.value === '') assignment.delete(select.dataset.teamFor);
      else assignment.set(select.dataset.teamFor, Number(select.value));
      updateSummary();
      renderResult();
    }));
    body.querySelectorAll('[data-ffa-player]').forEach((checkbox) => checkbox.addEventListener('change', () => {
      if (checkbox.checked) ffaIds.add(checkbox.dataset.ffaPlayer);
      else ffaIds.delete(checkbox.dataset.ffaPlayer);
      updateSummary();
      renderResult();
    }));
  }
  el.querySelector('#match-teamcount').addEventListener('change', (event) => {
    teamCount = Math.min(6, Math.max(2, Number(event.target.value) || 2));
    event.target.value = teamCount;
    for (const [playerId, index] of assignment) if (index >= teamCount) assignment.delete(playerId);
    renderBody();
  });
  el.querySelector('#match-ffa').addEventListener('change', (event) => {
    isFfa = event.target.checked;
    renderBody();
  });
  renderBody();
}
