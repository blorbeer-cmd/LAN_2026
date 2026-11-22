import { historyItemHtml as sharedHistoryItemHtml } from '../historyItem.js';
import { competitionBettingHtml, competitionStartActionHtml, competitionBettingSummaryHtml, competitionMatchesTipFilter, wireCompetitionBetting, competitionCorrection, bettingHiddenHintHtml } from './points.js';
let pointsContext = null;
// Matchmaking view (FR-16..18): pick a game + present players, draw balanced
// teams. Results are stored in shared state (updated live via the
// matchmaking:generated socket event) so everyone at the party sees the same
// draw, not just whoever clicked the button.

import { api } from '../api.js';
import { icon } from '../icons.js';
import { domainIcon } from '../domainIcons.js';
import { confirmDialog, openModal } from '../modal.js';
import { state, gameById, catalogGames, gamesWithHistory, eventPlayers, defaultCatalogGameId } from '../state.js';
import { escapeHtml, avatarHtml, formatDateTime, seatConflictIconHtml, webUrlHref } from '../format.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { playerSkillHtml, teamSkillHtml } from '../skillDisplay.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';
import { emptyStateHtml } from '../emptyState.js';
import { teamMoveControlHtml, REMOVE_FROM_TEAMS_VALUE } from '../tournamentTeamDraft.js';
import { filterRosterPicker, pruneRosterSelection, rosterPickerHtml, wireRosterPicker } from '../rosterPicker.js';
import { resultFormHtml, wireResultForm } from '../resultDialog.js';
import { withStepUp } from '../reauth.js';
import { isGroupAdmin } from '../groupContext.js';
import { RESTORE_FOCUS_EVENT } from '../viewRenderState.js';
import { copyText } from '../clipboard.js';
import { actionMenuHtml } from '../actionMenu.js';

// Persists across re-renders of this view (but not across a full page
// reload) so toggling checkboxes survives a re-roll without extra plumbing.
let checkedIds = null;
// True while checkedIds is only the placeholder of a render before the roster
// loaded (see defaultRosterSelection); the first render with players decides.
let rosterSelectionProvisional = false;
let avoidAdjacentOpponents = false;
// Tracks which game's default `avoidAdjacentOpponents` currently reflects, so
// switching games re-applies that game's stored default (considerSeatNeighborsDefault)
// exactly once per change, without clobbering a manual toggle on repeat re-renders
// for the same game (e.g. from an unrelated realtime update).
let avoidAdjacentOpponentsGameId = null;
let teamCountValue = '2';
let bettingAllowed = true;
const canOfferBetting = () => Boolean(state.activeEvent?.pointsEnabled &&
  state.activeEvent.status === 'published' && !state.activeEvent.isEnded);

// Tournament team names are capped server-side (TEAM_NAME_MAX_LENGTH).
const DRAW_TEAM_NAME_MAX_LENGTH = 30;

// Draw teams have no stored name: it is derived from the current lineup, so
// moving a player updates it with the next render. A solo team is named after
// its player, a drafted lineup after its captain (the first player of each
// drafted team, see draft.ts); a balanced draw keeps the neutral numbering.
export function defaultDrawTeamName(draw, team, index) {
  const solo = team.players.length === 1 ? team.players[0].name : null;
  const captain = draw.source === 'draft' ? team.players[0]?.name : null;
  const name = solo ?? (captain ? `Team ${captain}` : `Team ${index + 1}`);
  // The limit counts UTF-16 code units; drop a high surrogate left over when
  // the cut splits an emoji, so the name stays well-formed.
  return name.slice(0, DRAW_TEAM_NAME_MAX_LENGTH).replace(/[\uD800-\uDBFF]$/, '').trim();
}

// A draw cannot form more teams than it has players (POST /api/matchmaking
// refuses that too), so the "Anzahl Teams" field is capped at the current
// selection: typing a larger number snaps to it, and deselecting players pulls
// an already-higher value down with them. The floor stays at the field's
// minimum of 2 so an (almost) empty selection never produces an invalid cap;
// an empty field (automatic team count) is left alone.
export function teamCountMax(selectedCount) {
  return Math.max(2, selectedCount);
}

export function capTeamCountValue(value, selectedCount) {
  const max = teamCountMax(selectedCount);
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > max ? String(max) : value;
}
let drawPlayerSearchQuery = '';

// Which of the two team-formation workflows is currently open below the
// shared game picker — only one shows at a time so the game+mode choice
// reads as one linear step instead of two competing panels.
let teamsMode = 'draw';

// The draw's first selection: whoever is shown as playing, else everyone.
// Null while the roster is still empty: the app renders the start view before
// its first snapshot, and fixing an empty selection then kept "Teams
// auslosen" disabled for good once the players arrived.
export function defaultRosterSelection(live, players) {
  if (players.length === 0) return null;
  const playing = new Set(live.filter((p) => p.state === 'playing').map((p) => p.player_id));
  return playing.size > 0 ? playing : new Set(players.map((p) => p.id));
}

// Vote's "Match generieren" hands its result over before navigating here:
// the winning game and the players who want to play it replace the current
// draw setup, so only the team count is left to choose. The search is
// cleared so every preselected player is visible.
export function prepareDrawFromVote({ gameId, playerIds }) {
  state.selectedGameId = gameId;
  checkedIds = new Set(playerIds);
  rosterSelectionProvisional = false;
  drawPlayerSearchQuery = '';
  teamsMode = 'draw';
}

// Captain-draft state: the latest draft (active or finished) as delivered by
// GET /api/draft or the draft:changed socket event. A running draft takes
// over the whole view on every device (that's the point — it's a live event
// everyone watches), so it lives here in the Teams view rather than in its
// own tab. A *finished* draft doesn't get any special treatment here beyond
// that — its teams already landed in matchmaking_draws (see draft.ts), so
// they show up in Historie below like any other draw.
let draftCache = null; // { draft: {...} | null }
let draftLoading = false;
let draftPlayerIds = null; // independently selected participants for the next draft
let draftCaptainIds = new Set(); // captains chosen in the start form
let draftPlayerSearchQuery = '';

async function loadDraft(ctx) {
  draftLoading = true;
  try {
    draftCache = await api.draft.get();
  } catch {
    draftCache = { draft: null };
  } finally {
    draftLoading = false;
    ctx.rerender();
  }
}

// Called from app.js on every draft:changed socket event — the payload IS
// the fresh state, so no extra round trip is needed.
export function setDraftState(payload) {
  draftCache = payload;
}

// Cached separately from `state` (like votes.js does for Vote-Historie)
// since it's fetched from its own endpoint, scoped to whichever game is
// currently selected.
let historyCache = null;
let historyLoading = false;
let historyForGameId = null;
let historyStale = false;
let historyRequestVersion = 0;
let historyCursor = null;
let openDrawsCache = [];
let openDrawsSectionOpen = false;
let historyFilter = 'all';
// Game filter of Historie ('' = all games). Independent of the game picker
// above, which only prepares the next draw.
let historyGameFilter = '';
let tipFilter = 'all';
let mineOnly = false;
let historySectionOpen = false;
const expandedHistoryIds = new Set();
let historyError = false;

let tournamentCache = null;
let tournamentLoading = false;
let tournamentStale = false;
let tournamentRequestVersion = 0;
let tournamentError = false;
const tournamentDetailCache = new Map();
const tournamentDetailLoading = new Set();
const tournamentDetailErrors = new Set();
let tournamentDetailVersion = 0;

async function loadHistoryTournamentDetail(id, ctx) {
  if (tournamentDetailCache.has(id) || tournamentDetailLoading.has(id) || tournamentDetailErrors.has(id)) return;
  const version = tournamentDetailVersion;
  tournamentDetailLoading.add(id);
  try {
    const detail = await api.tournaments.get(id);
    if (version === tournamentDetailVersion) tournamentDetailCache.set(id, detail);
  } catch {
    if (version === tournamentDetailVersion) tournamentDetailErrors.add(id);
  } finally {
    if (version === tournamentDetailVersion) {
      tournamentDetailLoading.delete(id);
      ctx.rerender();
    }
  }
}

async function loadMatchTournaments(ctx) {
  const version = ++tournamentRequestVersion;
  tournamentLoading = true;
  tournamentStale = false;
  try {
    const list = await api.tournaments.list();
    if (version === tournamentRequestVersion) {
      tournamentCache = list;
      tournamentError = false;
    }
  } catch {
    if (version === tournamentRequestVersion) tournamentError = true;
  } finally {
    if (version === tournamentRequestVersion) {
      tournamentLoading = false;
      ctx.rerender();
    }
  }
}

export function invalidateMatchTournaments({ hard = false } = {}) {
  tournamentRequestVersion += 1;
  tournamentLoading = false;
  tournamentStale = true;
  tournamentDetailVersion += 1;
  tournamentDetailCache.clear();
  tournamentDetailLoading.clear();
  tournamentDetailErrors.clear();
  if (hard) tournamentCache = null;
}

async function loadHistory(gameId, ctx, { append = false } = {}) {
  const version = ++historyRequestVersion;
  historyLoading = true;
  historyStale = false;
  try {
    // Keep the oldest visible match as an anchor when a realtime event refreshes
    // the list. A fresh first page alone would discard every page the user loaded.
    const oldestId = !append && historyForGameId === gameId && historyCache?.length > 20
      ? historyCache.at(-1).id : null;
    const maxRows = oldestId ? historyCache.length + 50 : 20;
    const loaded = [];
    let cursor = append ? historyCursor : null;
    let nextCursor = null;
    let openDraws = null;
    do {
      const res = await api.matchmaking.history(gameId, {
        kind: 'matches',
        mine: mineOnly,
        cursor,
        limit: oldestId ? Math.min(50, maxRows - loaded.length) : 20,
      });
      if (version !== historyRequestVersion) return;
      loaded.push(...res.history);
      if (!cursor) openDraws = res.openDraws ?? [];
      nextCursor = res.nextCursor;
      const anchorIndex = oldestId ? loaded.findIndex((draw) => draw.id === oldestId) : -1;
      if (anchorIndex !== -1) {
        const last = loaded[anchorIndex];
        const hasOlder = anchorIndex < loaded.length - 1 || nextCursor !== null;
        loaded.length = anchorIndex + 1;
        nextCursor = hasOlder ? { before: last.generatedAt, beforeId: last.id } : null;
        break;
      }
      cursor = nextCursor;
    } while (oldestId && cursor && loaded.length < maxRows);
    if (version === historyRequestVersion) {
      historyCache = append ? [...(historyCache ?? []), ...loaded] : loaded;
      if (!append) {
        openDrawsCache = openDraws ?? [];
        // The "Neue Auslosung" card keeps its own copy of the draw. A lineup
        // change whose live signal was missed (reconnect, conflict) must
        // reach it too, or its dialogs keep acting on the old teams.
        const fresh = state.lastMatchmaking && openDrawsCache.find((draw) => draw.id === state.lastMatchmaking.id);
        if (fresh) state.lastMatchmaking = { ...state.lastMatchmaking, ...fresh };
      }
      historyCursor = nextCursor;
      historyForGameId = gameId;
      historyError = false;
    }
  } catch {
    if (version === historyRequestVersion) {
      if (historyForGameId !== gameId) historyCache = [];
      historyForGameId = gameId;
      historyError = true;
    }
  } finally {
    if (version === historyRequestVersion) {
      historyLoading = false;
      ctx.rerender();
    }
  }
}

// Called from app.js whenever a matchmaking:generated or
// matchmaking:draws-changed event arrives, so history is never more than one
// re-render stale.
export function invalidateMatchmakingHistory({ hard = false } = {}) {
  historyRequestVersion += 1;
  historyLoading = false;
  historyStale = true;
  if (hard) {
    historyCache = null;
    historyForGameId = null;
    historyCursor = null;
    openDrawsCache = [];
  }
}

// A running captain draft belongs to exactly one event, so switching the
// workspace has to drop it alongside the history — otherwise the previous
// event's draft board stays on screen and its pick buttons keep firing
// against a draft the new workspace cannot see.
export function invalidateMatchmakingDraft() {
  draftCache = null;
  draftLoading = false;
}

// A draw currently on screen either comes from the freshly-generated result
// (state.lastMatchmaking) or from the history list — both use the same
// shape (see parseDrawRow on the server), so lookups/updates work uniformly.
function findDrawById(id) {
  if (state.lastMatchmaking?.id === id) return state.lastMatchmaking;
  return historyCache?.find((d) => d.id === id) ?? openDrawsCache.find((draw) => draw.id === id) ?? null;
}

function includesMe(players) {
  const myId = getMyId();
  return Boolean(myId && players.some((player) => player.id === myId));
}

function playerNamesHtml(players) {
  const myId = getMyId();
  return players.map((player) => player.id === myId
    ? `<strong>${escapeHtml(player.name)}</strong>` : escapeHtml(player.name)).join(', ');
}

// Removing a player is offered wherever the server can accept it: an open
// draw keeps at least two teams, a recorded result keeps every team (its
// place decides everyone else's points). Tournament lineups stay frozen.
function canRemoveDrawPlayer(draw, team) {
  if (draw.tournamentId) return false;
  return team.players.length > 1 || (!draw.matchId && draw.teams.length > 2);
}

// Draggable row of one drawn player. Dropping it on another team moves it;
// dragging it out of the lineup removes it (after confirmation). Touch gets
// the same choices in the native team picker, keyboards use arrows/Entf.
function drawPlayerRowHtml(draw, team, teamIndex, player, { teamNames, movable, content }) {
  const removable = canRemoveDrawPlayer(draw, team);
  const hint = [movable ? 'auf ein anderes Team ziehen zum Verschieben' : '', removable ? 'unten auf „Hier ablegen zum Entfernen“ ziehen zum Entfernen' : '']
    .filter(Boolean).join(', ');
  return `<div class="team-player-move-row"><button type="button" class="team-player tournament-drag-player" draggable="true" data-move-draw="${draw.id}" data-move-player="${player.id}" data-team-index="${teamIndex}"${removable ? ' data-removable="true"' : ''} aria-label="${escapeHtml(player.name)}${movable ? ' verschieben' : ''}${removable ? `${movable ? ' oder' : ''} entfernen` : ''}" title="${escapeHtml(hint.charAt(0).toUpperCase() + hint.slice(1))}">
      ${content}
    </button>${teamMoveControlHtml({
      teamNames: movable ? teamNames : [teamNames[teamIndex]],
      currentIndex: movable ? teamIndex : 0,
      playerName: player.name,
      removable,
      attributes: `data-move-draw-select="${draw.id}" data-move-player="${player.id}"`,
    })}</div>`;
}

function drawIncludesMe(draw) {
  return draw.teams.some((team) => includesMe(team.players));
}

// Who performed the lineup: the draw, the finished Captain Draft or the
// rematch. A since-removed account leaves no line.
function drawCreatorHtml(draw, style = '') {
  if (!draw.createdByName) return '';
  const label = draw.source === 'draft' ? 'Draft von' : draw.source === 'rematch' ? 'Rematch von' : 'Ausgelost von';
  return `<span class="muted"${style ? ` style="${style}"` : ''}>${label} ${escapeHtml(draw.createdByName)}</span>`;
}

// Event participants who are not part of this lineup yet, alphabetically.
function drawAddCandidates(draw) {
  const inDraw = new Set(draw.teams.flatMap((team) => team.players.map((player) => player.id)));
  return eventPlayers().filter((player) => !inDraw.has(player.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// One drawn/recorded lineup: team cards plus, for a still-unrecorded draw,
// draggable player rows and the button to record a result — which is what
// changes its actions inside the shared Historie. Arrow keys provide the
// keyboard path for moving a player between teams.
function renderDrawCard(draw, { editable: editableInput, showGame = false, collapsible = false }) {
  // A draw that became a tournament is frozen like a recorded one, but it has
  // no result of its own: no winner, no "Remis", just the link to its bracket.
  const inTournament = Boolean(draw.tournamentId);
  const editable = editableInput && !inTournament;
  // A drawn lineup carries the ratings it was balanced with, so it keeps
  // showing those instead of drifting when someone rates the game later. A
  // drafted lineup was never balanced by rating and stores none, so its rows
  // stay informational and read from the current state.
  const hasSkillSnapshot = draw.source !== 'draft' || draw.teams.some((team) => team.skillSnapshot === true);
  const skillOptions = hasSkillSnapshot
    ? { stored: true, balanced: draw.source !== 'draft' }
    : { balanced: false, current: true };
  const teamNames = draw.teams.map((team, index) => defaultDrawTeamName(draw, team, index));
  const teamsHtml = draw.teams
    .map((t, i) => {
      // Only meaningful once a result is actually recorded (read-only cards)
      // — the skill-balance "Score" above is a different number (the draw's
      // rating total), so this is labeled distinctly to avoid confusion.
      const resultParts = [];
      if (t.rank != null) resultParts.push(`Platz ${t.rank}`);
      if (t.score != null) resultParts.push(`Punktestand ${t.score}`);
      const resultLine = resultParts.length
        ? `<div class="muted" style="font-size:var(--font-size-xs);">${resultParts.join(' · ')}</div>`
        : '';
      const decided = Boolean(draw.matchId);
      const isWinner = decided && draw.winnerTeamIndex === i;
      const isLoser = decided && draw.winnerTeamIndex !== null && !isWinner;

      return `
      <div class="team-card tournament-draft-team matchmaking-draw-team${isWinner ? ' is-winner' : ''}${isLoser ? ' is-loser' : ''}" role="group" aria-label="${escapeHtml(teamNames[i])}${isWinner ? ', Gewinner' : ''}" ${editable ? `data-draw-drop-team="${i}" data-draw-id="${draw.id}"` : ''}>
        <div class="team-card-header">
          <span class="row matchmaking-draw-team-title" style="gap:var(--space-2);"><span class="matchmaking-draw-team-name">${escapeHtml(teamNames[i])}</span>${isWinner ? '<span class="tournament-fixture-score is-pick">Win</span>' : ''}</span>
          ${teamSkillHtml(t.players, draw.gameId, skillOptions)}
        </div>
        ${resultLine}
        ${t.players
          .map(
            (p) => `
          ${(() => {
            const content = `${avatarHtml(p, 18)}
            <span class="team-player-name" style="flex:1;">${p.id === getMyId() ? `<strong>${escapeHtml(p.name)}</strong>` : escapeHtml(p.name)}</span>
            ${seatConflictIconHtml(p)}
            ${playerSkillHtml(p, draw.gameId, skillOptions)}`;
            return editable
              ? drawPlayerRowHtml(draw, t, i, p, { teamNames, movable: true, content })
              : `<div class="team-player">${content}</div>`;
          })()}`
          )
          .join('')}
      </div>`;
    })
    .join('');

  const seatingNote = draw.seatPairsConsidered
    ? draw.seatConflicts > 0
      ? `<div class="muted" style="font-size:var(--font-size-xs);">${icon('armchair')} ${draw.seatConflicts} von ${draw.seatPairsConsidered} Sitznachbarschaft(en) mussten trotzdem gegeneinander antreten (sonst wäre es zu unfair geworden).</div>`
      : ''
    : '';

  // General match actions share one "Aktion" menu; betting keeps its own
  // "Wetten" menu beside it. "Spiel starten" closes the tips but reads as a
  // match action, so it joins the general menu and never sits beside
  // "Jetzt tippen".
  const keyPrefix = collapsible ? 'match' : 'match-fresh';
  const betting = inTournament ? '' : competitionBettingHtml('draw', draw.id, pointsContext,
    { separateStart: true, ...(collapsible ? {} : { keyPrefix: 'betting-fresh' }) });
  const actions = drawActionMenuHtml(draw, [
    ...(inTournament
      ? [`<button type="button" class="btn btn-sm" data-open-draw-tournament="${escapeHtml(draw.tournamentId)}">${escapeHtml(draw.tournamentName ?? 'Turnier')}</button>`]
      : editable
      ? [
        draw.matchId ? '' : `<button type="button" class="btn btn-sm" data-draw-server-info="${escapeHtml(draw.id)}" aria-haspopup="dialog">Server und Passwort</button>`,
        `<button type="button" class="btn btn-sm" data-record-draw="${draw.id}">Ergebnis eintragen</button>`,
        draw.matchId || !drawAddCandidates(draw).length ? '' : `<button type="button" class="btn btn-sm" data-add-draw-player="${draw.id}" aria-haspopup="dialog">Spieler hinzufügen</button>`,
        draw.matchId ? '' : `<button type="button" class="btn btn-sm" data-shuffle-draw="${draw.id}">Neu mischen</button>`,
        `<button type="button" class="btn btn-sm" data-draw-tournament="${draw.id}">Turnier erstellen</button>`,
        competitionStartActionHtml('draw', draw.id, pointsContext),
      ]
      : [
        `<button type="button" class="btn btn-sm" data-edit-draw-result="${draw.id}">Ergebnis bearbeiten</button>`,
        `<button type="button" class="btn btn-sm" data-rematch-draw="${draw.id}">Rematch</button>`,
      ]),
    collapsible && isGroupAdmin() ? `<button type="button" class="btn btn-sm btn-danger" data-delete-draw="${draw.id}">Auslosung löschen</button>` : '',
  ], `${keyPrefix}-${inTournament ? 'tournament' : editable ? 'open' : 'result'}-${draw.id}`);

  if (collapsible) {
    const meta = `<span class="muted">${formatDateTime(draw.generatedAt)}</span>
      <span class="muted">${draw.teams.length} Teams</span>${drawCreatorHtml(draw)}${draw.source === 'draft' ? '<span class="badge">Captain Draft</span>' : ''}${inTournament ? '' : competitionBettingSummaryHtml('draw', draw.id)}`;
    return historyItemHtml(`o-${draw.id}`, draw.gameName, meta, `${actions}${betting}`,
      `<div class="tournament-team-preview-grid" data-draw-teams="${draw.id}">${teamsHtml}</div>${seatingNote}`, 'matchmaking-open-draw-item', drawIncludesMe(draw));
  }

  return `
    <div class="card stack matchmaking-draw-card" data-draw-card="${draw.id}">
      <div class="matchmaking-draw-head">
        <div class="row" style="gap:var(--space-2);flex-wrap:wrap;min-width:0;">
          ${showGame ? `<span class="player-name">${drawIncludesMe(draw) ? `<strong>${escapeHtml(draw.gameName)}</strong>` : escapeHtml(draw.gameName)}</span>` : ''}
          <span class="muted" style="font-size:var(--font-size-xs);">${formatDateTime(draw.generatedAt)}</span>
          ${drawCreatorHtml(draw, 'font-size:var(--font-size-xs);')}
          ${draw.source === 'draft' ? '<span class="badge">Captain Draft</span>' : ''}
          ${draw.matchId && draw.isDraw ? '<span class="tournament-fixture-score">Remis</span>' : ''}
          ${inTournament ? '' : competitionBettingSummaryHtml('draw', draw.id)}
        </div>
        ${actions || betting ? `<div class="matchmaking-draw-actions">${actions}${betting}</div>` : ''}
      </div>
      <div class="tournament-team-preview-grid" data-draw-teams="${draw.id}">${teamsHtml}</div>
      ${seatingNote}
      ${inTournament ? '' : bettingHiddenHintHtml()}
    </div>`;
}

// Server address and password are optional; clearing both fields removes them.
// A server given as a web address (a join or browser link) also gets an
// "open" action; an IP:port or plain name stays copy-only.
function openDrawServerDialog(draw, ctx) {
  const openLink = (id, label, value) => {
    const href = webUrlHref(value);
    return `<a class="icon-btn" data-open-draw-server="${id}"${href ? ` href="${escapeHtml(href)}"` : ' hidden'} target="_blank" rel="noopener noreferrer" aria-label="${label} öffnen" title="${label} öffnen">${icon('squareArrowOutUpRight')}</a>`;
  };
  const field = (id, label, value, maxLength, { linkable = false } = {}) => `
      <div>
        <label class="field-label" for="${id}">${label}</label>
        <div class="row matchmaking-draw-server-field">
          <input type="text" id="${id}" maxlength="${maxLength}" autocomplete="off" value="${escapeHtml(value ?? '')}" />
          ${linkable ? openLink(id, label, value) : ''}
          <button type="button" class="icon-btn" data-copy-draw-server="${id}" aria-label="${label} kopieren" title="${label} kopieren"${value ? '' : ' disabled'}>${icon('copy')}</button>
        </div>
      </div>`;
  const { close, el } = openModal('Server und Passwort', `
    <form class="stack" data-draw-server-form>
      <div class="muted result-dialog-subtitle">${escapeHtml(draw.gameName)} · ${draw.teams.length} Teams</div>
      ${field('draw-server-address', 'Server', draw.serverAddress, 100, { linkable: true })}
      ${field('draw-server-password', 'Passwort', draw.serverPassword, 60)}
      <div class="draw-tournament-footer"><button type="submit" class="btn btn-primary btn-sm">Speichern</button></div>
    </form>`);
  const address = el.querySelector('#draw-server-address');
  const password = el.querySelector('#draw-server-password');
  address.focus();
  el.querySelectorAll('[data-open-draw-server]').forEach((link) => {
    const input = el.querySelector(`#${link.dataset.openDrawServer}`);
    input.addEventListener('input', () => {
      const href = webUrlHref(input.value);
      link.hidden = !href;
      if (href) link.href = href;
      else link.removeAttribute('href');
    });
  });
  el.querySelectorAll('[data-copy-draw-server]').forEach((button) => {
    const input = el.querySelector(`#${button.dataset.copyDrawServer}`);
    input.addEventListener('input', () => { button.disabled = !input.value.trim(); });
    button.addEventListener('click', async () => {
      try {
        await copyText(input.value.trim());
        showToast(`${input.labels[0].textContent} kopiert.`);
      } catch {
        input.select();
        showToast('Bitte den markierten Text manuell kopieren.', { error: true });
      }
    });
  });
  el.querySelector('[data-draw-server-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const updated = await api.matchmaking.updateDrawServer(draw.id, {
        serverAddress: address.value.trim() || null,
        serverPassword: password.value.trim() || null,
      });
      applyUpdatedDraw(updated);
      close();
      ctx.rerender();
      showToast(updated.serverAddress || updated.serverPassword ? 'Server gespeichert.' : 'Server entfernt.');
    } catch (err) {
      submit.disabled = false;
      showToast(err.message, { error: true });
    }
  });
}

// A dialog acted on teams another device changed meanwhile (409
// draw_lineup_changed): close it, fetch that draw directly (the history
// lists follow the "Meine" filter and may leave it out) and reload the
// lists, so the card and a reopened dialog start from the new teams.
async function reloadAfterLineupConflict(drawId, close, ctx, message) {
  close();
  showToast(message, { error: true });
  try {
    const current = await api.matchmaking.getDraw(drawId);
    if (current.matchId || current.tournamentId) {
      if (state.lastMatchmaking?.id === drawId) state.lastMatchmaking = null;
    } else {
      applyUpdatedDraw(current);
    }
  } catch {
    // Deleted meanwhile, or offline: the list reload below still applies.
    if (state.lastMatchmaking?.id === drawId) state.lastMatchmaking = null;
  }
  invalidateMatchmakingHistory();
  ctx.rerender();
}

// Adds a participant who is not drawn yet. "Automatisch" lets the server put
// them into the smallest team (the weaker one on a tie), so the common case
// needs only the player.
function openDrawAddPlayerDialog(draw, ctx) {
  const candidates = drawAddCandidates(draw);
  // A chosen team is a position in this lineup, so it travels along and the
  // server refuses it if the draw was reshuffled or edited meanwhile.
  const drawLineup = draw.teams.map((team) => team.players.map((player) => player.id));
  const options = candidates.map((player) => ({ value: player.id, label: player.name }));
  const teamNames = draw.teams.map((team, index) => defaultDrawTeamName(draw, team, index));
  const { close, el } = openModal('Spieler hinzufügen', `
    <form class="stack" data-draw-add-player-form>
      <div class="muted result-dialog-subtitle">${escapeHtml(draw.gameName)} · ${draw.teams.length} Teams</div>
      <div>
        <label class="field-label is-required" for="draw-add-player-search">Spieler</label>
        ${searchSelectHtml('draw-add-player', options, '', { placeholder: 'Spieler suchen', label: 'Verfügbare Spieler' })}
      </div>
      <div>
        <label class="field-label" for="draw-add-player-team">Team</label>
        <select id="draw-add-player-team">
          <option value="">Automatisch</option>
          ${teamNames.map((name, index) => `<option value="${index}">${escapeHtml(name)}</option>`).join('')}
        </select>
      </div>
      <div class="draw-tournament-footer"><button type="submit" class="btn btn-primary btn-sm">Hinzufügen</button></div>
    </form>`);
  wireSearchSelect(el, 'draw-add-player', options, { emptyText: 'Kein passender Spieler gefunden.' });
  const playerInput = el.querySelector('#draw-add-player');
  const search = el.querySelector('#draw-add-player-search');
  search.focus();
  el.querySelector('[data-draw-add-player-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const player = candidates.find((entry) => entry.id === playerInput.value);
    if (!player) {
      showToast('Bitte einen Spieler auswählen.', { error: true });
      search.focus();
      return;
    }
    const teamValue = el.querySelector('#draw-add-player-team').value;
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      applyUpdatedDraw(await api.matchmaking.addDrawPlayer(draw.id, teamValue === ''
        ? { playerId: player.id }
        : { playerId: player.id, teamIndex: Number(teamValue), drawLineup }));
      close();
      ctx.rerender();
      showToast(`${player.name} hinzugefügt.`);
    } catch (err) {
      if (err.code === 'draw_lineup_changed') {
        await reloadAfterLineupConflict(draw.id, close, ctx, err.message);
        return;
      }
      submit.disabled = false;
      showToast(err.message, { error: true });
    }
  });
}

// Draw results keep the Match API shape; only the form is shared.
function openDrawResultDialog(draw, ctx) {
  const recorded = Boolean(draw.matchId);
  // The lineup this dialog shows; the server refuses the result if another
  // device reshuffled, extended or edited the draw in the meantime.
  const drawLineup = draw.teams.map((team) => team.players.map((player) => player.id));
  const hasValues = recorded && draw.teams.some((team) => team.score != null);
  const teams = draw.teams.map((team, index) => ({ name: defaultDrawTeamName(draw, team, index), players: team.players.map((player) => player.name) }));
  const correction = competitionCorrection('draw', draw.id);
  const { close, el } = openModal('Ergebnis', `
    <div class="muted result-dialog-subtitle">${escapeHtml(draw.gameName)} · ${draw.teams.length} Teams</div>
    ${recorded ? correction.html : ''}
    ${resultFormHtml({ teams, prefix: 'draw-result', mode: hasValues ? 'score' : 'winner', winnerIndex: recorded && !hasValues ? draw.winnerTeamIndex ?? (draw.isDraw ? -1 : undefined) : undefined, scores: draw.teams.map((team) => team.score) })}`);
  wireResultForm(el, {
    teams,
    mode: hasValues ? 'score' : 'winner',
    onSave: async ({ mode, scores, ranks, winnerIndex }) => {
      const payloadTeams = draw.teams.map((team, index) => ({
        playerIds: team.players.map((player) => player.id),
        score: mode === 'score' ? scores[index] : null,
        rank: mode === 'score' ? ranks[index] : null,
      }));
      if (recorded) {
        await api.matches.update(draw.matchId, { teams: payloadTeams, winnerTeamIndex: winnerIndex, isDraw: winnerIndex === null, ...correction.payload(el) });
      } else {
        try {
          await api.matches.create({ gameId: draw.gameId, drawId: draw.id, drawLineup, teams: payloadTeams, winnerTeamIndex: winnerIndex, isDraw: winnerIndex === null });
        } catch (err) {
          if (err.code !== 'draw_lineup_changed') throw err;
          await reloadAfterLineupConflict(draw.id, close, ctx, err.message);
          return;
        }
        if (state.lastMatchmaking?.id === draw.id) state.lastMatchmaking = null;
        // Open lineups of every game are listed, but Historie shows the
        // selected game only: follow the result so it appears there.
        state.selectedGameId = draw.gameId;
      }
      expandedHistoryIds.add(draw.id);
      historySectionOpen = true;
      // Make the intent visible to the shared render-state snapshot as well.
      // Updating only the module flag lets restoration close it again.
      const history = document.querySelector('#view-container [data-matchmaking-section="history"]');
      if (history) history.open = true;
      invalidateMatchmakingHistory();
      close();
      await ctx.refresh();
      showToast('Ergebnis gespeichert.');
    },
  });
  if (recorded && correction.readOnly) {
    el.querySelectorAll('[data-result-entry] input, [data-result-entry] button').forEach((control) => { control.disabled = true; });
  }
}

// Wires D&D/touch/keyboard player moves and result buttons for every draw
// card currently in the DOM — shared between the fresh result and history.
const TOURNAMENT_FORMAT_LABELS = {
  single_elimination: 'K.O.-Turnier',
  round_robin: 'Liga (jeder gegen jeden)',
  group_knockout: 'Gruppenphase + K.O.',
};

// Turns a drawn lineup into a tournament: the teams are fixed by the draw,
// only format, names and lobby details are chosen here. The draw is claimed
// server-side in the same step, so it can no longer become a single result.
function openDrawTournamentDialog(draw, ctx) {
  const form = { format: 'single_elimination', twoLegged: false, trackScore: false, thirdPlaceMatch: false, groupCount: 2, advancers: 1 };
  let bodyEl;
  const names = draw.teams.map((team, index) => defaultDrawTeamName(draw, team, index));
  const lobby = { name: '', password: '' };

  function render() {
    const hasLeague = form.format === 'round_robin' || form.format === 'group_knockout';
    // Needs two semifinal losers; the group stage decides its count later.
    const canPlayThird = form.format === 'group_knockout' || (form.format === 'single_elimination' && draw.teams.length >= 4);
    bodyEl.innerHTML = `
      <form class="stack draw-tournament-form" id="draw-tournament-form">
        <div>
          <label class="field-label is-required" for="draw-tournament-format">Turnierformat</label>
          <select id="draw-tournament-format">
            ${Object.entries(TOURNAMENT_FORMAT_LABELS).map(([value, label]) => `<option value="${value}" ${value === form.format ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        ${
          form.format === 'group_knockout'
            ? `<div class="field-row">
                 <div><label class="field-label is-required" for="draw-tournament-groups">Anzahl Gruppen</label><input type="number" id="draw-tournament-groups" min="2" value="${form.groupCount}" /></div>
                 <div><label class="field-label is-required" for="draw-tournament-advancers">Aufsteiger pro Gruppe</label><input type="number" id="draw-tournament-advancers" min="1" value="${form.advancers}" /></div>
               </div>`
            : ''
        }
        <div>
          <span class="field-label">Teamnamen</span>
          <div class="draw-tournament-team-names">
            ${names.map((name, index) => `<input type="text" data-draw-team-name="${index}" maxlength="30" value="${escapeHtml(name)}" aria-label="Name Team ${index + 1}" />`).join('')}
          </div>
        </div>
        <div class="draw-tournament-options">
          ${hasLeague ? `<label class="check-row"><input type="checkbox" id="draw-tournament-two-legged" ${form.twoLegged ? 'checked' : ''} /> Hin- & Rückrunde${form.format === 'group_knockout' ? ' in der Gruppenphase' : ''}</label>` : ''}
          ${canPlayThird ? `<label class="check-row"><input type="checkbox" id="draw-tournament-third-place" ${form.thirdPlaceMatch ? 'checked' : ''} /> Spiel um Platz 3</label>` : ''}
          <label class="check-row"><input type="checkbox" id="draw-tournament-track-score" ${form.trackScore ? 'checked' : ''} /> Ergebnisse inkl. Punktestand</label>
        </div>
        <div class="field-row">
          <div><span class="title-with-info field-label"><label for="draw-tournament-lobby">Lobby-Basisname</label>${infoTooltipHtml(
              'draw-tournament-lobby-help',
              'Lobby-Basisname',
              'Aus dem Basisnamen wird für jede gleichzeitig spielbare Paarung ein eindeutiger Lobbyname erzeugt. Das zuerst genannte Team eröffnet die Lobby.'
            )}</span><input type="text" id="draw-tournament-lobby" maxlength="60" placeholder="LAN26" value="${escapeHtml(lobby.name)}" /></div>
          <div><label class="field-label" for="draw-tournament-password">Lobby-Passwort</label><input type="text" id="draw-tournament-password" maxlength="60" placeholder="zocken123" value="${escapeHtml(lobby.password)}" /></div>
        </div>
        <div class="draw-tournament-footer"><button type="submit" class="btn btn-primary btn-sm">Turnier erstellen</button></div>
      </form>`;

    const read = () => {
      form.format = bodyEl.querySelector('#draw-tournament-format').value;
      form.twoLegged = Boolean(bodyEl.querySelector('#draw-tournament-two-legged')?.checked);
      form.trackScore = bodyEl.querySelector('#draw-tournament-track-score').checked;
      form.thirdPlaceMatch = Boolean(bodyEl.querySelector('#draw-tournament-third-place')?.checked);
      form.groupCount = Number(bodyEl.querySelector('#draw-tournament-groups')?.value ?? form.groupCount);
      form.advancers = Number(bodyEl.querySelector('#draw-tournament-advancers')?.value ?? form.advancers);
      bodyEl.querySelectorAll('[data-draw-team-name]').forEach((input) => {
        names[Number(input.dataset.drawTeamName)] = input.value;
      });
      lobby.name = bodyEl.querySelector('#draw-tournament-lobby').value;
      lobby.password = bodyEl.querySelector('#draw-tournament-password').value;
    };
    wireInfoTooltips(bodyEl);
    bodyEl.querySelector('#draw-tournament-format').addEventListener('change', () => {
      read();
      render();
    });
    bodyEl.querySelector('#draw-tournament-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      read();
      try {
        const created = await api.tournaments.create({
          gameId: draw.gameId,
          format: form.format,
          twoLegged: form.twoLegged,
          trackScore: form.trackScore,
          ...(form.format !== 'round_robin' ? { thirdPlaceMatch: form.thirdPlaceMatch } : {}),
          ...(form.format === 'group_knockout' ? { groupCount: form.groupCount, advancersPerGroup: form.advancers } : {}),
          ...(lobby.name.trim() ? { lobbyName: lobby.name.trim() } : {}),
          ...(lobby.password.trim() ? { lobbyPassword: lobby.password.trim() } : {}),
          teams: draw.teams.map((team, index) => ({
            name: names[index].trim() || defaultDrawTeamName(draw, team, index),
            playerIds: team.players.map((player) => player.id),
          })),
          drawId: draw.id,
          // The teams shown here; a lineup changed elsewhere is refused.
          drawLineup: draw.teams.map((team) => team.players.map((player) => player.id)),
        });
        close();
        if (state.lastMatchmaking?.id === draw.id) state.lastMatchmaking = { ...state.lastMatchmaking, tournamentId: created.id, tournamentName: created.name };
        invalidateMatchmakingHistory();
        window.dispatchEvent(new CustomEvent('respawn:navigate', {
          detail: { view: 'tournaments', localRoute: { kind: 'detail', id: created.id } },
        }));
      } catch (err) {
        if (err.code === 'draw_lineup_changed') {
          await reloadAfterLineupConflict(draw.id, close, ctx, err.message);
          return;
        }
        showToast(err.message, { error: true });
      }
    });
  }

  const { close } = openModal('Turnier erstellen', '<div data-draw-tournament-body></div>', {
    onMount: (el) => {
      bodyEl = el.querySelector('[data-draw-tournament-body]');
      render();
    },
  });
}

function applyUpdatedDraw(updated) {
  // Merge so client-only fields of a fresh draw (avoidPairs) survive.
  if (state.lastMatchmaking?.id === updated.id) state.lastMatchmaking = { ...state.lastMatchmaking, ...updated };
  if (historyCache) {
    const idx = historyCache.findIndex((draw) => draw.id === updated.id);
    if (idx !== -1) historyCache[idx] = updated;
  }
  const openIndex = openDrawsCache.findIndex((draw) => draw.id === updated.id);
  if (openIndex !== -1) openDrawsCache[openIndex] = updated;
}

// Drag removal works like the Jam queue: dragging a removable player reveals
// a fixed bottom target, and only a drop on that target removes (after
// confirmation). The document listeners are registered once and read the
// draw being dragged.
let draggedDrawPlayer = null;
let drawRemovalCtx = null;
let dragOutWired = false;

async function removeDrawPlayer(drawId, playerId) {
  const ctx = drawRemovalCtx;
  const draw = findDrawById(drawId);
  const team = draw?.teams.find((entry) => entry.players.some((player) => player.id === playerId));
  const player = team?.players.find((entry) => entry.id === playerId);
  if (!player || !canRemoveDrawPlayer(draw, team)) return;
  const consequence = draw.matchId
    ? `Das Ergebnis bleibt bestehen, aber ${player.name} erhält dafür keine Punkte mehr.`
    : team.players.length === 1 ? 'Das Team fällt dann weg.' : '';
  const confirmed = await confirmDialog(`${player.name} aus diesem Match entfernen? ${consequence}`.trim(), {
    title: 'Spieler entfernen', confirmText: 'Entfernen', danger: true,
  });
  if (!confirmed) {
    // Resets a touch picker that still shows "Aus dem Match entfernen".
    ctx?.rerender();
    return;
  }
  try {
    applyUpdatedDraw(await api.matchmaking.removeDrawPlayer(draw.id, player.id));
    ctx?.rerender();
    showToast(`${player.name} entfernt.`);
  } catch (err) {
    showToast(err.message, { error: true });
    ctx?.rerender();
  }
}

function isDragOutTarget(event) {
  if (!draggedDrawPlayer?.removable || !(event.target instanceof Element)) return false;
  return Boolean(event.target.closest('[data-draw-remove-zone]'));
}

// Same bottom drop target as the Jam queue. A rerender of the view drops the
// node and the next drag creates it again.
function dragRemoveZone() {
  const view = document.getElementById('view-container');
  if (!view) return null;
  let zone = view.querySelector(':scope > [data-draw-remove-zone]');
  if (!zone) {
    view.insertAdjacentHTML('beforeend', `<div class="drag-remove-zone" data-draw-remove-zone hidden role="status" aria-live="polite">${icon('trash')}<strong>Hier ablegen zum Entfernen</strong></div>`);
    zone = view.querySelector(':scope > [data-draw-remove-zone]');
  }
  return zone;
}

function showDragRemoveZone(visible) {
  const zone = visible ? dragRemoveZone() : document.querySelector('[data-draw-remove-zone]');
  if (!zone) return;
  zone.hidden = !visible;
  zone.classList.remove('is-over');
}

function wireDragOutRemoval() {
  if (dragOutWired) return;
  dragOutWired = true;
  document.addEventListener('dragover', (event) => {
    const over = isDragOutTarget(event);
    document.querySelector('[data-draw-remove-zone]')?.classList.toggle('is-over', over);
    if (!over) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });
  document.addEventListener('drop', (event) => {
    if (!isDragOutTarget(event)) return;
    event.preventDefault();
    const { drawId, playerId } = draggedDrawPlayer;
    draggedDrawPlayer = null;
    showDragRemoveZone(false);
    removeDrawPlayer(drawId, playerId);
  });
}

function wireDrawCards(container, ctx) {
  container.querySelectorAll('[data-delete-draw]').forEach((btn) => btn.addEventListener('click', async () => {
    const draw = findDrawById(btn.dataset.deleteDraw);
    if (!draw) return;
    const message = draw.matchId
      ? 'Dieses Match-Ergebnis und seine Auslosung löschen? Das Ergebnis verschwindet auch aus der Rangliste.'
      : 'Diese Auslosung löschen?';
    if (!(await confirmDialog(message, { title: 'Spiel löschen', confirmText: 'Löschen', danger: true }))) return;
    try {
      const removed = await withStepUp(() => api.matchmaking.removeDraw(draw.id));
      if (removed === undefined) return;
      if (state.lastMatchmaking?.id === draw.id) state.lastMatchmaking = null;
      openDrawsCache = openDrawsCache.filter((entry) => entry.id !== draw.id);
      if (historyCache) historyCache = historyCache.filter((entry) => entry.id !== draw.id);
      expandedHistoryIds.delete(draw.id);
      expandedHistoryIds.delete(`o-${draw.id}`);
      invalidateMatchmakingHistory();
      ctx.rerender();
      showToast('Spiel gelöscht.');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }));
  container.querySelectorAll('[data-delete-tournament]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.deleteTournament;
    const tournament = (tournamentCache ?? []).find((entry) => entry.id === id);
    if (!tournament) return;
    if (!(await confirmDialog(`Turnier „${tournament.name}“ löschen? Bereits gespeicherte Match-Ergebnisse bleiben in der Rangliste. Platzierungsboni entfallen.`, {
      title: 'Turnier löschen', confirmText: 'Löschen', danger: true,
    }))) return;
    try {
      const removed = await withStepUp(() => api.tournaments.remove(id));
      if (removed === undefined) return;
      tournamentCache = (tournamentCache ?? []).filter((entry) => entry.id !== id);
      tournamentDetailCache.delete(id);
      expandedHistoryIds.delete(`t-${id}`);
      invalidateMatchTournaments();
      invalidateMatchmakingHistory();
      ctx.rerender();
      showToast('Turnier gelöscht.');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }));
  container.querySelectorAll('[data-draw-server-info]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const draw = findDrawById(btn.dataset.drawServerInfo);
      if (draw && !draw.matchId && !draw.tournamentId) openDrawServerDialog(draw, ctx);
    });
  });
  container.querySelectorAll('[data-add-draw-player]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const draw = findDrawById(btn.dataset.addDrawPlayer);
      if (draw && !draw.matchId && !draw.tournamentId) openDrawAddPlayerDialog(draw, ctx);
    });
  });
  container.querySelectorAll('[data-shuffle-draw]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const draw = findDrawById(btn.dataset.shuffleDraw);
      if (!draw || draw.matchId || draw.tournamentId) return;
      const confirmed = await confirmDialog('Die Spieler werden neu auf die Teams verteilt. Manuelle Verschiebungen gehen dabei verloren.', {
        title: 'Teams neu mischen', confirmText: 'Neu mischen',
      });
      if (!confirmed) return;
      try {
        applyUpdatedDraw(await api.matchmaking.shuffleDraw(draw.id));
        ctx.rerender();
        showToast('Teams neu gemischt.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
  container.querySelectorAll('[data-draw-tournament]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const draw = findDrawById(btn.dataset.drawTournament);
      if (draw) openDrawTournamentDialog(draw, ctx);
    });
  });
  container.querySelectorAll('[data-open-draw-tournament]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('respawn:navigate', {
        detail: { view: 'tournaments', localRoute: { kind: 'detail', id: btn.dataset.openDrawTournament } },
      }));
    });
  });
  drawRemovalCtx = ctx;
  wireDragOutRemoval();

  async function moveDrawPlayer(drawId, playerId, toTeamIndex) {
    try {
      applyUpdatedDraw(await api.matchmaking.moveDrawPlayer(drawId, playerId, toTeamIndex));
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
      ctx.rerender();
    }
  }

  container.querySelectorAll('[data-move-draw-select]').forEach((select) => {
    select.addEventListener('change', () => {
      if (select.value === REMOVE_FROM_TEAMS_VALUE) removeDrawPlayer(select.dataset.moveDrawSelect, select.dataset.movePlayer);
      else moveDrawPlayer(select.dataset.moveDrawSelect, select.dataset.movePlayer, Number(select.value));
    });
  });

  let draggedPlayer = null;
  const clearDragState = () => {
    container.querySelectorAll('.is-drag-target, .is-dragging').forEach((element) => {
      element.classList.remove('is-drag-target', 'is-dragging');
    });
    draggedPlayer = null;
    draggedDrawPlayer = null;
    showDragRemoveZone(false);
  };

  container.querySelectorAll('[data-move-draw]').forEach((playerRow) => {
    playerRow.addEventListener('dragstart', (event) => {
      draggedPlayer = { drawId: playerRow.dataset.moveDraw, playerId: playerRow.dataset.movePlayer };
      draggedDrawPlayer = { ...draggedPlayer, removable: playerRow.dataset.removable === 'true' };
      playerRow.classList.add('is-dragging');
      if (draggedDrawPlayer.removable) showDragRemoveZone(true);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify(draggedPlayer));
    });
    playerRow.addEventListener('dragend', clearDragState);
    playerRow.addEventListener('keydown', (event) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && playerRow.dataset.removable === 'true') {
        event.preventDefault();
        removeDrawPlayer(playerRow.dataset.moveDraw, playerRow.dataset.movePlayer);
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const draw = findDrawById(playerRow.dataset.moveDraw);
      if (!draw || draw.matchId) return;
      const currentIndex = Number(playerRow.dataset.teamIndex);
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const toTeamIndex = (currentIndex + direction + draw.teams.length) % draw.teams.length;
      moveDrawPlayer(draw.id, playerRow.dataset.movePlayer, toTeamIndex);
    });
  });

  container.querySelectorAll('[data-draw-drop-team]').forEach((teamCard) => {
    const drawId = teamCard.dataset.drawId;
    const toTeamIndex = Number(teamCard.dataset.drawDropTeam);
    teamCard.addEventListener('dragover', (event) => {
      if (!draggedPlayer || draggedPlayer.drawId !== drawId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      teamCard.classList.add('is-drag-target');
    });
    teamCard.addEventListener('dragleave', (event) => {
      if (event.relatedTarget && teamCard.contains(event.relatedTarget)) return;
      teamCard.classList.remove('is-drag-target');
    });
    teamCard.addEventListener('drop', (event) => {
      event.preventDefault();
      let player = draggedPlayer;
      if (!player) {
        try {
          player = JSON.parse(event.dataTransfer.getData('text/plain'));
        } catch {
          player = null;
        }
      }
      clearDragState();
      if (player?.drawId === drawId) moveDrawPlayer(drawId, player.playerId, toTeamIndex);
    });
  });

  container.querySelectorAll('[data-record-draw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const draw = findDrawById(btn.dataset.recordDraw);
      if (draw) openDrawResultDialog(draw, ctx);
    });
  });

  container.querySelectorAll('[data-edit-draw-result]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const draw = findDrawById(btn.dataset.editDrawResult);
      if (draw) openDrawResultDialog(draw, ctx);
    });
  });

  container.querySelectorAll('[data-rematch-draw]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const draw = findDrawById(btn.dataset.rematchDraw);
      if (!draw) return;
      const teams = draw.teams.map((t) => ({ playerIds: t.players.map((p) => p.id) }));
      try {
        // Logs a fresh matchmaking_draws row for the same lineup (unlike a
        // "Teams auslosen" re-roll, this keeps the exact teams) so the result
        // entered below links back to it in Historie, same as any other draw
        // — see the /rematch endpoint's comment.
        const create = async (allowBetting) => {
          const rematchDraw = await api.matchmaking.rematch({ gameId: draw.gameId, teams, bettingAllowed: allowBetting });
          state.lastMatchmaking = rematchDraw;
          ctx.rerender();
          return rematchDraw;
        };
        if (canOfferBetting()) {
          const { close } = openModal('Rematch erstellen', `<form class="stack" data-rematch-form>
            <label class="check-row"><input type="checkbox" name="bettingAllowed" checked>Wetten erlauben</label>
            <div class="row" style="justify-content:flex-end"><button type="submit" class="btn btn-primary">Rematch erstellen</button></div></form>`, {
            onMount(el) {
              el.querySelector('form').addEventListener('submit', async (event) => {
                event.preventDefault();
                const button = event.currentTarget.querySelector('button');
                const allowBetting = new FormData(event.currentTarget).has('bettingAllowed');
                button.disabled = true;
                try {
                  const rematchDraw = await create(allowBetting);
                  close();
                  if (!allowBetting) openDrawResultDialog(rematchDraw, ctx);
                }
                catch (error) { button.disabled = false; showToast(error.message, { error: true }); }
              });
            },
          });
          return;
        }
        openDrawResultDialog(await create(teams.length === 2), ctx);
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}

function renderHistoryDetails(title, count, content) {
  return `<details class="card history-details collapsible-section" data-matchmaking-section="history" ${historySectionOpen ? 'open' : ''}>
    <summary class="collapsible-section-header">
      <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
      <h2>${title}</h2>
      <span class="collapsible-section-summary-end">
        <span class="badge badge-offline">${count}</span>
      </span>
    </summary>
    <div class="collapsible-section-content">${content}</div>
  </details>`;
}

function historyItemHtml(id, title, meta, actions, details, extraClass = '', isMine = false) {
  return sharedHistoryItemHtml(id, title, meta, actions, details, {
    open: expandedHistoryIds.has(id), extraClass, isMine,
  });
}

function wireHistoryItemToggles(container, ctx) {
  container.querySelectorAll('[data-history-toggle]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.historyToggle;
    if (expandedHistoryIds.has(id)) expandedHistoryIds.delete(id);
    else expandedHistoryIds.add(id);
    const expanded = expandedHistoryIds.has(id);
    button.setAttribute('aria-expanded', String(expanded));
    button.closest('.matchmaking-history-item').querySelector('.matchmaking-history-details').hidden = !expanded;
    if (expanded && id.startsWith('t-')) loadHistoryTournamentDetail(id.slice(2), ctx);
  }));
}

// One "Aktion" menu bundles a match card's general actions; a single action
// stays a direct button. It floats like the "Wetten" menu, so collapsed tiles
// and scrolling sections never clip it. The key names the card's state, so a
// menu kept open across a live refresh never reopens on a draw that has since
// been recorded or turned into a tournament.
function drawActionMenuHtml(draw, actions, key) {
  return actionMenuHtml(actions, `Aktion: ${draw.gameName}`, { key, floating: true });
}

function historyMatchHtml(draw) {
  const winner = draw.winnerTeamIndex == null ? null : draw.teams[draw.winnerTeamIndex];
  const winnerName = winner ? defaultDrawTeamName(draw, winner, draw.winnerTeamIndex) : '';
  const scoreChip = draw.teams.length === 2 && draw.teams.every((team) => team.score != null)
    ? `<span class="tournament-fixture-score"><span class="${draw.winnerTeamIndex === 0 ? 'is-win' : ''}">${draw.teams[0].score}</span> : <span class="${draw.winnerTeamIndex === 1 ? 'is-win' : ''}">${draw.teams[1].score}</span></span>`
    : '';
  const result = winner
    ? `<span class="tournament-fixture-score is-pick">Win</span> <strong>${escapeHtml(winnerName)}${winner.score != null && draw.teams.length !== 2 ? ` · <span class="is-win">${winner.score}</span>` : ''}</strong> ${scoreChip}`
    : `<span class="tournament-fixture-score">${draw.isDraw ? 'Remis' : 'Ohne Ergebnis'}</span>`;
  const meta = `<span class="muted">${formatDateTime(draw.generatedAt)}</span> ${result} <span class="muted">${draw.teams.length} Teams</span>${drawCreatorHtml(draw)}${draw.source === 'draft' ? '<span class="badge">Captain Draft</span>' : ''}${competitionBettingSummaryHtml('draw', draw.id)}`;
  const actions = drawActionMenuHtml(draw, [
    `<button type="button" class="btn btn-sm" data-edit-draw-result="${draw.id}">Ergebnis bearbeiten</button>`,
    `<button type="button" class="btn btn-sm" data-rematch-draw="${draw.id}">Rematch</button>`,
    isGroupAdmin() ? `<button type="button" class="btn btn-sm btn-danger" data-delete-draw="${draw.id}">Match löschen</button>` : '',
  ], `match-result-${draw.id}`);
  const order = draw.teams.map((team, index) => ({ team, index })).sort((a, b) => {
    if (a.team.rank != null || b.team.rank != null) return (a.team.rank ?? Infinity) - (b.team.rank ?? Infinity) || a.index - b.index;
    return Number(b.index === draw.winnerTeamIndex) - Number(a.index === draw.winnerTeamIndex) || a.index - b.index;
  });
  const teams = order.map(({ team, index }) => {
    const won = index === draw.winnerTeamIndex;
    const hasSkill = draw.source !== 'draft' || team.skillSnapshot === true;
    return `<div class="matchmaking-history-team${!won && draw.winnerTeamIndex != null ? ' is-loser' : ''}">
      <div class="matchmaking-history-team-head">
        ${team.rank != null ? `<span class="lb-rank${team.rank === 1 ? ' is-first' : ''}">${team.rank}</span>` : ''}
        <strong>${escapeHtml(defaultDrawTeamName(draw, team, index))}</strong>
        ${won && team.rank == null ? '<span class="tournament-fixture-score is-pick">Win</span>' : ''}
        ${teamSkillHtml(team.players, draw.gameId, hasSkill
          ? { stored: true, balanced: draw.source !== 'draft' }
          : { balanced: false, current: true })}
        ${team.score != null ? `<span class="matchmaking-history-team-score${won ? ' is-win' : ''}">${team.score}</span>` : ''}
      </div>
      ${canRemoveDrawPlayer(draw, team)
        ? `<div class="matchmaking-history-players matchmaking-history-player-rows">${team.players.map((player) =>
          drawPlayerRowHtml(draw, team, index, player, {
            teamNames: draw.teams.map((entry, entryIndex) => defaultDrawTeamName(draw, entry, entryIndex)),
            movable: false,
            content: `<span class="team-player-name">${player.id === getMyId() ? `<strong>${escapeHtml(player.name)}</strong>` : escapeHtml(player.name)}</span>`,
          })).join('')}</div>`
        : `<div class="muted matchmaking-history-players">${playerNamesHtml(team.players)}</div>`}
    </div>`;
  }).join('');
  const seating = draw.seatConflicts > 0
    ? `<div class="muted">${icon('armchair')} ${draw.seatConflicts} von ${draw.seatPairsConsidered} Sitznachbarschaft(en) mussten trotzdem gegeneinander antreten.</div>` : '';
  return historyItemHtml(draw.id, draw.gameName, meta, `${actions}${competitionBettingHtml('draw', draw.id, pointsContext)}`,
    `<div class="matchmaking-history-teams" data-draw-teams="${draw.id}">${teams}</div>${seating}`, '', drawIncludesMe(draw));
}

function historyTournamentDetailHtml(tournament) {
  if (tournamentDetailErrors.has(tournament.id)) {
    return `<div class="muted" role="alert">Turnierdaten konnten nicht geladen werden.
      <button type="button" class="btn btn-sm" data-retry-tournament-detail="${escapeHtml(tournament.id)}">Erneut laden</button></div>`;
  }
  const detail = tournamentDetailCache.get(tournament.id);
  if (!detail) return '<div class="muted">Lädt…</div>';

  const standings = new Map();
  (detail.standings ?? []).forEach((entry, index) => standings.set(entry.teamId, { rank: index + 1, ...entry }));
  (detail.groups ?? []).forEach((group) => group.standings.forEach((entry, index) =>
    standings.set(entry.teamId, { rank: index + 1, groupIndex: group.groupIndex, ...entry })));
  // The third-place match shares the final's round, so exits are read from
  // the tree only; its places come with the final's from the server.
  const knockout = detail.matches.filter((match) => (detail.format === 'single_elimination' || match.stage === 'knockout')
    && !match.isThirdPlace);
  const final = knockout.reduce((latest, match) => !latest || match.round > latest.round ? match : latest, null);
  const places = new Map(detail.status === 'completed' ? (detail.placements ?? []).map((entry) => [entry.teamId, entry.place]) : []);
  const placement = (teamId) => {
    if (detail.format === 'round_robin') return standings.get(teamId)?.rank ?? Infinity;
    return places.get(teamId) ?? Infinity;
  };
  const knockoutRound = (teamId) => Math.max(0, ...knockout.filter((match) =>
    match.teamAId === teamId || match.teamBId === teamId).map((match) => match.round));
  const orderedTeams = [...detail.teams].sort((a, b) => placement(a.id) - placement(b.id)
    || knockoutRound(b.id) - knockoutRound(a.id)
    || (standings.get(a.id)?.rank ?? Infinity) - (standings.get(b.id)?.rank ?? Infinity)
    || a.name.localeCompare(b.name));
  const cards = orderedTeams.map((team) => {
    const standing = standings.get(team.id);
    const place = placement(team.id);
    const playedMatches = detail.matches.filter((match) => !match.isBye &&
      (match.winnerTeamId !== null || match.isDraw) && (match.teamAId === team.id || match.teamBId === team.id));
    const wins = playedMatches.filter((match) => match.winnerTeamId === team.id).length;
    const lastKnockout = knockout.filter((match) => (match.teamAId === team.id || match.teamBId === team.id)
      && match.winnerTeamId && match.winnerTeamId !== team.id).sort((a, b) => b.round - a.round)[0];
    const stage = lastKnockout && final ? lastKnockout.round === final.round - 1 ? 'Halbfinale'
      : lastKnockout.round === final.round - 2 ? 'Viertelfinale' : `Runde ${lastKnockout.round}` : null;
    const placeLabel = Number.isFinite(place) ? `${place}. Platz` : '';
    const exitLabel = stage && !placeLabel ? `${stage} ausgeschieden`
      : standing && detail.format === 'group_knockout' && !placeLabel
        ? `Gruppe ${standing.groupIndex + 1} · Platz ${standing.rank}` : null;
    const context = [
      exitLabel,
      detail.format === 'group_knockout' && !exitLabel?.startsWith('Gruppe ') ? `Gruppe ${(team.groupIndex ?? 0) + 1}` : null,
      standing ? `${standing.played} Sp` : `${wins} Siege · ${playedMatches.length} Sp`,
    ].filter(Boolean).join(' · ');
    return `<div class="matchmaking-history-team">
      <div class="matchmaking-history-team-head">
        ${placeLabel ? `<span class="matchmaking-history-placement lb-rank${place === 1 ? ' is-first' : ''}" title="${escapeHtml(placeLabel)}" aria-label="${escapeHtml(placeLabel)}">${place}</span>` : ''}
        <strong>${escapeHtml(team.name)}</strong>
        ${teamSkillHtml(team.players, detail.gameId, { balanced: false, current: true })}
        ${standing ? `<span class="matchmaking-history-team-score" title="Tabellenpunkte">${standing.points} Pkt</span>` : ''}
      </div>
      <div class="muted matchmaking-history-players">${team.players.length ? playerNamesHtml(team.players) : 'Spieler nicht verfügbar'}</div>
      <div class="muted matchmaking-history-team-context">${escapeHtml(context)}</div>
    </div>`;
  }).join('');
  return `<div class="muted matchmaking-history-tournament-summary">${escapeHtml(TOURNAMENT_FORMAT_LABELS[detail.format])} · ${detail.teams.length} Teams · ${tournament.decidedMatchCount}/${tournament.matchCount} Partien</div>
    <div class="matchmaking-history-teams">${cards}</div>`;
}

function historyTournamentHtml(tournament) {
  const outcome = tournament.championName
    ? `<span class="tournament-fixture-score is-pick">Win</span> <strong>${escapeHtml(tournament.championName)}</strong> <span class="muted">1. Platz</span>`
    : '<span class="badge">Turnier läuft</span>';
  const meta = `<span class="muted">${formatDateTime(tournament.createdAt)}</span> ${outcome}
    <span class="muted">${escapeHtml(tournament.name)}</span>${competitionBettingSummaryHtml('tournament', tournament.id)}`;
  const actions = `<button type="button" class="btn btn-sm" data-open-draw-tournament="${escapeHtml(tournament.id)}">Turnier</button>
    ${isGroupAdmin() ? `<button type="button" class="tournament-fixture-action" data-delete-tournament="${escapeHtml(tournament.id)}" aria-label="Turnier löschen" title="Turnier löschen">${icon('trash')}</button>` : ''}`;
  return historyItemHtml(`t-${tournament.id}`, tournament.gameName, meta, `${actions}${competitionBettingHtml('tournament', tournament.id, pointsContext, { tournamentId: tournament.id })}`,
    historyTournamentDetailHtml(tournament), 'is-tournament', Boolean(getMyId() && tournament.participantIds?.includes(getMyId())));
}

// Open lineups and running tournaments of every game: the game picker only
// prepares the next draw. The server returns open draws for all games.
function filteredOpenDraws() {
  return historyFilter === 'tournaments' ? []
    : openDrawsCache.filter((draw) => (!mineOnly || drawIncludesMe(draw)) && competitionMatchesTipFilter('draw', draw.id, tipFilter));
}

function filteredTournaments(completed) {
  const myId = getMyId();
  return historyFilter === 'matches' ? [] : (tournamentCache ?? []).filter((tournament) =>
    (!completed || !historyGameFilter || tournament.gameId === historyGameFilter)
    && (tournament.status === 'completed') === completed
    && (completed || competitionMatchesTipFilter('tournament', tournament.id, tipFilter))
    && (!mineOnly || Boolean(myId && tournament.participantIds?.includes(myId))));
}

function renderMatchFilters() {
  const count = Number(historyFilter !== 'all') + Number(Boolean(historyGameFilter)) + Number(mineOnly) + Number(state.activeEvent?.pointsEnabled && tipFilter !== 'all');
  return `<div class="matchmaking-history-filters" role="group" aria-label="Spiele und Turniere filtern">
    <div><details class="action-menu game-catalog-filter-menu" data-floating-action-menu data-action-menu="match-filters">
      <summary class="btn btn-sm game-catalog-filter-trigger" aria-label="Match-Filter">Filter${count ? ` (${count})` : ''} ${icon('chevronDown')}</summary>
      <div class="action-menu-panel game-catalog-filter-panel" popover="manual">
        <div class="stack game-catalog-filter-section" role="group" aria-label="Art">
          <span class="game-catalog-filter-heading">Art</span><div class="chip-list">
            ${[['all', 'Alle'], ['matches', 'Matches'], ['tournaments', 'Turniere']].map(([key, label]) => `<button type="button" class="chip${historyFilter === key ? ' is-active' : ''}" data-history-filter="${key}" aria-pressed="${historyFilter === key}">${label}</button>`).join('')}
          </div>
        </div>
        <div class="stack game-catalog-filter-section" role="group" aria-label="Spiel">
          <label class="game-catalog-filter-heading" for="match-history-game-filter">Spiel</label>
          <select id="match-history-game-filter" data-history-game-filter>
            <option value="">Alle Spiele</option>
            ${[...gamesWithHistory()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
              .map((game) => `<option value="${escapeHtml(game.id)}"${historyGameFilter === game.id ? ' selected' : ''}>${escapeHtml(game.name)}</option>`).join('')}
          </select>
        </div>
        <div class="stack game-catalog-filter-section" role="group" aria-label="Beteiligung">
          <span class="game-catalog-filter-heading">Beteiligung</span><div class="chip-list">
            <button type="button" class="chip${mineOnly ? ' is-active' : ''}" data-match-mine aria-pressed="${mineOnly}">Meine</button>
          </div>
        </div>
        ${state.activeEvent?.pointsEnabled ? `<div class="stack game-catalog-filter-section" role="group" aria-label="Dein Tipp bei offenen Spielen">
          <span class="game-catalog-filter-heading">Dein Tipp · offene Spiele</span><div class="chip-list">
            ${[['open', 'Noch offen'], ['placed', 'Abgegeben']].map(([key, label]) => `<button type="button" class="chip${tipFilter === key ? ' is-active' : ''}" data-match-tip-filter="${key}" aria-pressed="${tipFilter === key}">${label}</button>`).join('')}
          </div>
        </div>` : ''}
        ${count ? '<button type="button" class="btn btn-sm game-catalog-filter-reset" data-match-filter-reset>Filter zurücksetzen</button>' : ''}
      </div>
    </details></div>
  </div>`;
}

function renderOpenDraws() {
  const draws = filteredOpenDraws();
  const tournaments = filteredTournaments(false);
  if (!draws.length && !tournaments.length && (tipFilter === 'all' || !state.activeEvent?.pointsEnabled)) return '';
  const summary = [
    draws.length ? `${draws.length} Auslosungen` : null,
    tournaments.length ? `${tournaments.length} laufende Turniere` : null,
  ].filter(Boolean).join(' · ');
  return `<details class="card matchmaking-open-draws collapsible-section" data-matchmaking-section="open" ${openDrawsSectionOpen ? 'open' : ''}>
    <summary class="collapsible-section-header">
      <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
      <h2>Ohne Ergebnis</h2>
      <span class="collapsible-section-summary-end">
        <span class="muted">${summary}</span>
        <span class="badge badge-offline">Offen</span>
      </span>
    </summary>
    <div class="collapsible-section-content"><div id="match-history-open"></div></div>
  </details>`;
}

function renderHistory() {
  const tournaments = filteredTournaments(true);
  const matches = (historyForGameId === historyGameFilter ? historyCache ?? [] : [])
    .filter((draw) => draw.matchId && (!mineOnly || drawIncludesMe(draw)));
  const items = [
    ...(historyFilter === 'tournaments' ? [] : matches.map((draw) => ({ time: draw.generatedAt, html: historyMatchHtml(draw) }))),
    ...(historyFilter === 'matches' ? [] : tournaments.map((tournament) => ({ time: tournament.createdAt, html: historyTournamentHtml(tournament) }))),
  ].sort((a, b) => b.time - a.time).map((entry) => entry.html);
  const loading = (historyFilter !== 'tournaments' && historyForGameId !== historyGameFilter) ||
    (historyFilter === 'tournaments' && tournamentCache === null && !tournamentError);
  const emptyText = historyError || tournamentError ? 'Historie konnte nicht geladen werden.' : mineOnly ? 'Keine eigenen Ergebnisse.' : historyFilter === 'tournaments' ? 'Keine Turniere gefunden.' : 'Noch keine Matches.';
  const content = `${items.length ? items.join('') : emptyStateHtml(loading ? 'Lädt…' : emptyText, { className: 'empty-state-compact' })}
    ${(historyError || tournamentError) && items.length ? '<p class="muted" role="alert">Historie konnte nicht vollständig geladen werden.</p>' : ''}
    ${historyFilter !== 'tournaments' && historyCursor ? '<div class="matchmaking-history-more"><button type="button" class="btn btn-sm" data-history-more>Ältere laden</button></div>' : ''}`;
  return renderHistoryDetails('Historie', items.length, content);
}

function wireOpenDraws(container, ctx) {
  const section = container.querySelector('.matchmaking-open-draws');
  const openPanel = container.querySelector('#match-history-open');
  function releaseOpenDraws() {
    if (!openPanel) return;
    openPanel.replaceChildren();
    delete openPanel.dataset.rendered;
  }
  function populateOpenDraws() {
    if (!openPanel || !section?.open || openPanel.dataset.rendered) return;
    const tournaments = filteredTournaments(false);
    openPanel.innerHTML = [
      ...filteredOpenDraws().map((draw) => renderDrawCard(draw, { editable: true, showGame: true, collapsible: true })),
      ...tournaments.map(historyTournamentHtml),
    ].join('') || emptyStateHtml('Keine offenen Spiele gefunden.');
    openPanel.dataset.rendered = 'true';
    wireHistoryItemToggles(openPanel, ctx);
    wireDrawCards(openPanel, ctx);
    wireCompetitionBetting(openPanel, ctx);
    openPanel.querySelectorAll('[data-history-toggle^="t-"][aria-expanded="true"]').forEach((button) =>
      loadHistoryTournamentDetail(button.dataset.historyToggle.slice(2), ctx));
    openPanel.querySelectorAll('[data-retry-tournament-detail]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.retryTournamentDetail;
      tournamentDetailErrors.delete(id);
      loadHistoryTournamentDetail(id, ctx);
    }));
  }
  section?.addEventListener('toggle', () => {
    if (!section.isConnected) return;
    openDrawsSectionOpen = section.open;
    if (section.open) populateOpenDraws();
    else releaseOpenDraws();
  });
  populateOpenDraws();
}

function wireHistory(container, ctx) {
  const section = container.querySelector('.history-details');
  section?.addEventListener('toggle', () => {
    if (section.isConnected) historySectionOpen = section.open;
  });
  if (section) wireHistoryItemToggles(section, ctx);
  section?.querySelectorAll('[data-history-toggle^="t-"][aria-expanded="true"]').forEach((button) =>
    loadHistoryTournamentDetail(button.dataset.historyToggle.slice(2), ctx));
  container.querySelectorAll('[data-retry-tournament-detail]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.retryTournamentDetail;
    tournamentDetailErrors.delete(id);
    loadHistoryTournamentDetail(id, ctx);
  }));
  container.querySelectorAll('[data-history-filter]').forEach((button) => button.addEventListener('click', () => {
    historyFilter = button.dataset.historyFilter; ctx.rerender();
  }));
  container.querySelector('[data-history-game-filter]')?.addEventListener('change', (event) => {
    historyGameFilter = event.target.value; ctx.rerender();
  });
  container.querySelector('[data-match-mine]')?.addEventListener('click', () => {
    mineOnly = !mineOnly; invalidateMatchmakingHistory({ hard: true }); ctx.rerender();
  });
  container.querySelectorAll('[data-match-tip-filter]').forEach((button) => button.addEventListener('click', () => {
    tipFilter = tipFilter === button.dataset.matchTipFilter ? 'all' : button.dataset.matchTipFilter; ctx.rerender();
  }));
  container.querySelector('[data-match-filter-reset]')?.addEventListener('click', () => {
    historyFilter = 'all'; historyGameFilter = ''; mineOnly = false; tipFilter = 'all';
    invalidateMatchmakingHistory({ hard: true }); ctx.rerender();
  });
  container.querySelector('[data-history-more]')?.addEventListener('click', () => {
    if (!historyLoading && historyCursor) loadHistory(historyGameFilter, ctx, { append: true });
  });
}

function renderActiveTournaments() {
  // This overview is the live status of Match, not part of the filterable
  // history. It must therefore retain every running tournament while the
  // filters below narrow open draws and historical entries.
  const active = (tournamentCache ?? []).filter((tournament) => tournament.status !== 'completed');
  if (!active.length && !tournamentError) return '';
  return `<section class="card stack grouped-page-section home-current home-current--compact matchmaking-active-tournaments" aria-labelledby="match-active-tournaments-title">
    <div class="grouped-page-section-title"><h2 id="match-active-tournaments-title">Laufende Turniere</h2></div>
    ${active.length ? `<div class="home-current-items">${active.map((tournament) => `
      <article class="list-row home-current-row">
        <button type="button" class="home-current-navigate" data-open-draw-tournament="${escapeHtml(tournament.id)}">
          <span class="list-row-icon">${icon(domainIcon('tournaments'))}</span>
          <span class="home-current-copy"><span class="player-name">${escapeHtml(tournament.name)}</span>
            <span class="muted list-row-desc">${escapeHtml(TOURNAMENT_FORMAT_LABELS[tournament.format])} · ${tournament.decidedMatchCount}/${tournament.matchCount} Partien</span></span>
        </button>
      </article>`).join('')}</div>` : ''}
    ${tournamentError ? '<div class="muted">Turniere konnten nicht aktualisiert werden.</div>' : ''}
  </section>`;
}

// ---------- captain draft: live board ----------

function renderDraftBoard(draft) {
  // Captains pick by turn order, not by rating (routes/draft.ts): the values
  // here inform the picking captain, they never enter a calculation.
  const skillOptions = { balanced: false };
  const myId = getMyId();
  const isMyTurn = draft.turnCaptainId === myId;
  const turnCaptain = draft.teams[draft.turnCaptainIndex]?.captain;

  const teamsHtml = draft.teams
    .map(
      (t, i) => `
      <div class="team-card" ${draft.turnCaptainIndex === i ? 'style="border-color:var(--accent);"' : ''}>
        <div class="team-card-header">
          <span>${escapeHtml(t.captain.name)}</span>
          <span class="row" style="gap:var(--space-2);">${teamSkillHtml(t.players, draft.gameId, skillOptions)}${draft.turnCaptainIndex === i ? '<span style="color:var(--accent);">am Zug</span>' : ''}</span>
        </div>
        ${t.players.map((p) => `<div class="team-player">${avatarHtml(p, 20)} <span class="team-player-name">${escapeHtml(p.name)}</span>${playerSkillHtml(p, draft.gameId, skillOptions)}</div>`).join('')}
      </div>`
    )
    .join('');

  const poolHtml = draft.pool
    .map((p) =>
      isMyTurn
        ? `<button type="button" class="check-row draft-pool-player" data-draft-pick="${p.id}">${avatarHtml(p, 20)} <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>${playerSkillHtml(p, draft.gameId, skillOptions)}</button>`
        : `<div class="check-row draft-pool-player">${avatarHtml(p, 20)} <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>${playerSkillHtml(p, draft.gameId, skillOptions)}</div>`
    )
    .join('');

  return `
    <div class="card stack">
      <div class="matchmaking-draw-head">
        <div class="stack" style="gap:0;min-width:0;">
          <strong>Captain Draft läuft</strong>
          <span class="muted" style="font-size:var(--font-size-sm);">${escapeHtml(draft.gameName)}</span>
        </div>
        <div class="matchmaking-draw-actions">
          <span class="badge badge-playing">Live</span>
          <button type="button" class="btn btn-sm" id="draft-cancel">Abbrechen</button>
        </div>
      </div>
      <div class="section-title" style="margin:var(--space-2) 0 0;">Captains</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(var(--selection-card-min-width), 1fr));">${teamsHtml}</div>
      <div class="section-title" style="margin:var(--space-2) 0 0;">Spieler</div>
      <div class="player-selection-grid tournament-player-grid draft-pool-grid">${poolHtml}</div>
      ${isMyTurn ? '' : `<div class="muted" style="font-size:var(--font-size-sm);">Warten auf <strong>${escapeHtml(turnCaptain?.name ?? '?')}</strong>…</div>`}
    </div>`;
}

function wireDraftBoard(container, ctx) {
  const cancelBtn = container.querySelector('#draft-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      // Bind the confirmation to the draft it was opened for: if that draft
      // ends meanwhile, the server refuses instead of cancelling the next one.
      const draftId = draftCache?.draft?.id;
      if (!(await confirmDialog('Draft wirklich abbrechen?', { confirmText: 'Draft abbrechen', danger: true }))) return;
      try {
        draftCache = await api.draft.cancel(draftId);
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }

  container.querySelectorAll('[data-draft-pick]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        draftCache = await api.draft.pick(getMyId(), btn.dataset.draftPick);
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}

export function renderMatchmaking(container, ctx) {
  // Restoration and keyboard/browser actions can change native disclosures
  // without a summary click. Read their live state before replacing the DOM,
  // including when a refresh/filter temporarily removes a whole section.
  const openSection = container.querySelector('[data-matchmaking-section="open"]');
  const historySection = container.querySelector('[data-matchmaking-section="history"]');
  if (openSection) openDrawsSectionOpen = openSection.open;
  if (historySection) historySectionOpen = historySection.open;
  pointsContext = ctx;
  if (((tournamentCache === null && !tournamentError) || tournamentStale) && !tournamentLoading) loadMatchTournaments(ctx);
  const leading = `<h2 class="view-title">Match</h2>${renderActiveTournaments()}`;
  // Only accepted games can be drawn/drafted for — an open suggestion is not
  // something to build teams for yet (see catalogGames()). The picker still
  // lists a game that was moved back to the suggestions *after* it was drawn
  // or played, so its Ergebnis-/Rematch-Aktionen stay reachable.
  // Drawing and drafting stay blocked for such a game (see drawDisabledReason).
  const pickableGames = gamesWithHistory([state.lastMatchmaking?.gameId, state.selectedGameId]);
  if (catalogGames().length === 0 || eventPlayers().length === 0) {
    container.innerHTML = `${leading}${emptyStateHtml('Dafür braucht es mindestens ein Spiel im Katalog und 2 Spieler.')}`;
    wireDrawCards(container, ctx);
    return;
  }

  if (draftCache === null && !draftLoading) {
    loadDraft(ctx);
  }

  // A running draft takes over the view on every device — it's a shared live
  // event, and mixing it with the regular draw form would just distract. A
  // finished draft gets no special treatment here — its teams already sit in
  // Historie below (see draft.ts), same as any other draw.
  const draft = draftCache?.draft;
  if (draft && draft.status === 'active') {
    container.innerHTML = `${leading}${renderDraftBoard(draft)}`;
    wireDraftBoard(container, ctx);
    wireDrawCards(container, ctx);
    return;
  }

  if (checkedIds === null || rosterSelectionProvisional) {
    const selection = defaultRosterSelection(state.live, eventPlayers());
    rosterSelectionProvisional = selection === null;
    checkedIds = selection ?? new Set();
    draftPlayerIds = new Set(checkedIds);
  }
  if (draftPlayerIds === null) draftPlayerIds = new Set(checkedIds);
  // Both selections predate the active event's participant scoping (a stale
  // `state.live`-based default, or leftover from an event switch) and must be
  // pruned the same way, or a since-removed/never-accepted id would still
  // reach POST /api/matchmaking and fail competitionPlayersBelongToGroup.
  checkedIds = pruneRosterSelection(checkedIds, eventPlayers());
  draftPlayerIds = pruneRosterSelection(draftPlayerIds, eventPlayers());
  draftCaptainIds = new Set([...draftCaptainIds].filter((id) => draftPlayerIds.has(id)));
  teamCountValue = capTeamCountValue(teamCountValue, checkedIds.size);

  const selectedGameId = pickableGames.some((g) => g.id === state.selectedGameId) ? state.selectedGameId : defaultCatalogGameId();

  if (avoidAdjacentOpponentsGameId !== selectedGameId) {
    avoidAdjacentOpponentsGameId = selectedGameId;
    avoidAdjacentOpponents = Boolean(gameById(selectedGameId)?.considerSeatNeighborsDefault);
  }

  // A deleted game vanishes from the filter's options; keep the effective
  // filter in sync so Historie never filters by an id nobody can see or clear.
  if (historyGameFilter && !gamesWithHistory().some((game) => game.id === historyGameFilter)) historyGameFilter = '';
  if ((historyForGameId !== historyGameFilter || historyStale) && !historyLoading) {
    loadHistory(historyGameFilter, ctx);
  }

  const gameSelectOptions = pickableGames.map((g) => ({ value: g.id, label: g.name }));

  // Captains are selected only from the independently prepared draft roster;
  // every other selected participant becomes part of the live pick pool.
  const draftPlayers = eventPlayers().filter((p) => draftPlayerIds.has(p.id));
  const draftPoolSize = draftPlayers.length - draftCaptainIds.size;
  // A game that is only in the picker because it still carries history (see
  // pickableGames) must not start anything new — the server refuses it too.
  const selectedIsSuggestion = gameById(selectedGameId)?.isSuggestion === true;
  const suggestionBlockedReason =
    'Dieses Spiel steht wieder als Vorschlag in der Spiele-Liste. Erst in den Katalog aufnehmen, dann sind Auslosung und Draft wieder möglich.';

  const draftReady =
    !selectedIsSuggestion && draftCaptainIds.size >= 2 && draftCaptainIds.size <= 4 && draftPoolSize >= 1;
  // Mirrors the disabled "Draft starten" button below: named so the reason
  // is visible up front instead of only after a click is attempted.
  let draftDisabledReason = '';
  if (!draftReady) {
    if (selectedIsSuggestion) draftDisabledReason = suggestionBlockedReason;
    else if (draftCaptainIds.size < 2) draftDisabledReason = 'Mindestens 2 Captains auswählen, um den Draft zu starten.';
    else if (draftCaptainIds.size > 4) draftDisabledReason = 'Maximal 4 Captains auswählen.';
    else draftDisabledReason = 'Mindestens 1 weiteren Spieler zusätzlich zu den Captains auswählen.';
  }

  const drawReady = !selectedIsSuggestion && checkedIds.size >= 2;
  const drawDisabledReason = selectedIsSuggestion
    ? suggestionBlockedReason
    : 'Mindestens 2 Spieler auswählen, um Teams auszulosen.';

  const modeToggleHtml = `
      <div class="selection-toolbar" role="group" aria-labelledby="mm-mode-label">
        <span class="field-label" id="mm-mode-label">Modus</span>
        <button type="button" class="btn btn-sm${teamsMode === 'draw' ? ' btn-primary' : ''}" data-mm-mode="draw" aria-pressed="${teamsMode === 'draw'}">Auslosung</button>
        <button type="button" class="btn btn-sm${teamsMode === 'draft' ? ' btn-primary' : ''}" data-mm-mode="draft" aria-pressed="${teamsMode === 'draft'}">Captain Draft</button>
        ${infoTooltipHtml(
            'captain-draft-help',
            'Captain Draft',
            'Zuerst Teilnehmer, dann Captains benennen. Anschließend abwechselnd aus den Spielern wählen.'
          )}
      </div>`;

  container.innerHTML = `
    ${leading}
    <div class="card stack">
      <div class="matchmaking-setup-head">
        ${modeToggleHtml}
        <div>
          <label class="field-label is-required" for="mm-game-search">Spiel auswählen</label>
          ${searchSelectHtml('mm-game', gameSelectOptions, selectedGameId, { placeholder: 'Spiel suchen' })}
        </div>
      </div>

      ${teamsMode === 'draw' ? `
      <section class="match-mode-panel stack" aria-labelledby="matchmaking-draw-title">
        <h3 id="matchmaking-draw-title" class="visually-hidden">Auslosung</h3>
        ${rosterPickerHtml({
          id: 'mm-draw-roster',
          players: eventPlayers(),
          selectedIds: checkedIds,
          query: drawPlayerSearchQuery,
          searchId: 'mm-player-search',
          itemAttribute: 'data-mm-draw-search-item',
          playerAttribute: 'data-player',
          selectAllId: 'mm-select-all',
          toolbarLeadingHtml: `<div class="tournament-team-count-field">
            <label class="field-label" for="mm-teamcount">Anzahl Teams</label>
            <input type="number" id="mm-teamcount" min="2" max="${teamCountMax(checkedIds.size)}" value="${escapeHtml(teamCountValue)}" />
          </div>`,
          renderTrailing: (player) => playerSkillHtml(player, selectedGameId),
        })}
        <div class="card-footer-actions row" style="justify-content:flex-end;flex-wrap:wrap;">
          ${canOfferBetting() ? `<label class="check-row" style="padding:0;border-bottom:0"><input type="checkbox" id="mm-betting-allowed" ${bettingAllowed ? 'checked' : ''}>Wetten erlauben</label>` : ''}
          <div class="check-row" style="padding:0;border-bottom:0;">
            <input type="checkbox" id="mm-avoid-adjacent" ${avoidAdjacentOpponents ? 'checked' : ''} />
            <span class="title-with-info tournament-option-label">
              <label for="mm-avoid-adjacent">Sitznachbarn</label>
              ${infoTooltipHtml(
                'matchmaking-neighbors-help',
                'Sitznachbarn',
                'Sitznachbarn werden nach Möglichkeit in dasselbe Team gelost. Die Skill-Balance hat Vorrang, wenn beides nicht gleichzeitig möglich ist.'
              )}
            </span>
          </div>
          <div class="row">
            <button type="button" class="btn btn-primary btn-sm" id="mm-generate" ${drawReady ? '' : 'disabled'}>Teams auslosen</button>
            ${drawReady ? '' : infoTooltipHtml(
                'matchmaking-draw-disabled-help',
                'Warum ist „Teams auslosen“ deaktiviert?',
                drawDisabledReason,
                'warning'
              )}
          </div>
        </div>
      </section>` : ''}

      ${teamsMode === 'draft' ? `
      <section class="match-mode-panel stack" aria-labelledby="matchmaking-draft-title">
        <h3 id="matchmaking-draft-title" class="visually-hidden">Captain Draft</h3>
        ${rosterPickerHtml({
          id: 'mm-draft-roster',
          players: eventPlayers(),
          selectedIds: draftPlayerIds,
          query: draftPlayerSearchQuery,
          searchId: 'draft-player-search',
          itemAttribute: 'data-mm-draft-search-item',
          playerAttribute: 'data-draft-player',
          emptyAttribute: 'data-mm-draft-search-empty',
          toolbarLabel: 'Spieler',
          gridClass: 'captain-selection-grid',
          renderTrailing: (player) => playerSkillHtml(player, selectedGameId, { balanced: false }),
        })}
        <div class="captain-selection-group">
          ${rosterPickerHtml({
            id: 'mm-captain-roster',
            players: draftPlayers,
            selectedIds: draftCaptainIds,
            query: draftPlayerSearchQuery,
            itemAttribute: 'data-mm-captain-search-item',
            playerAttribute: 'data-captain-toggle',
            emptyAttribute: 'data-mm-captain-search-empty',
            toolbarLabel: 'Captains',
            gridClass: 'captain-selection-grid',
            showBulkActions: false,
            showSearch: false,
            renderTrailing: (player) => playerSkillHtml(player, selectedGameId, { balanced: false }),
          })}
        </div>
        <div class="card-footer-actions">
          ${canOfferBetting() ? `<label class="check-row" style="padding:0;border-bottom:0"><input type="checkbox" id="draft-betting-allowed" ${bettingAllowed ? 'checked' : ''}>Wetten erlauben</label>` : ''}
          <div class="row" style="flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-sm" id="draft-start" ${draftReady ? '' : 'disabled'}>Draft starten</button>
            ${draftReady ? '' : infoTooltipHtml(
                'matchmaking-draft-disabled-help',
                'Warum ist „Draft starten“ deaktiviert?',
                draftDisabledReason,
                'warning'
              )}
          </div>
        </div>
      </section>` : ''}
    </div>
    <div id="mm-result">${renderResult(state.lastMatchmaking)}</div>

    ${renderMatchFilters()}
    ${renderOpenDraws()}
    ${renderHistory()}
  `;

  wireInfoTooltips(container);
  wireDrawCards(container, ctx);
  wireCompetitionBetting(container, ctx);
  wireOpenDraws(container, ctx);
  wireHistory(container, ctx);
  wireRosterPicker(container, {
    id: 'mm-draw-roster',
    players: eventPlayers(),
    selectedIds: checkedIds,
    searchId: 'mm-player-search',
    onQueryChange: (query) => {
      drawPlayerSearchQuery = query;
    },
    onSelectionChange: () => ctx.rerender(),
  });
  wireRosterPicker(container, {
    id: 'mm-draft-roster',
    players: eventPlayers(),
    selectedIds: draftPlayerIds,
    searchId: 'draft-player-search',
    onQueryChange: (query) => {
      draftPlayerSearchQuery = query;
      // The one search field above narrows both the roster and the captain list.
      filterRosterPicker(container, 'mm-captain-roster', query);
    },
    onSelectionChange: ({ kind, playerId, checked }) => {
      if (kind === 'bulk') {
        draftCaptainIds = pruneRosterSelection(draftCaptainIds, eventPlayers().filter((player) => draftPlayerIds.has(player.id)));
      } else if (!checked) {
        draftCaptainIds.delete(playerId);
      }
      ctx.rerender();
    },
  });
  wireRosterPicker(container, {
    id: 'mm-captain-roster',
    players: draftPlayers,
    selectedIds: draftCaptainIds,
    onSelectionChange: ({ playerId, checked }) => {
      if (checked && draftCaptainIds.size > 4) {
        draftCaptainIds.delete(playerId);
        const checkbox = container.querySelector(
          `[data-roster-picker="mm-captain-roster"] [data-roster-picker-player="${CSS.escape(playerId)}"]`,
        );
        if (checkbox) checkbox.checked = false;
        showToast('Maximal 4 Captains.', { error: true });
        return;
      }
      ctx.rerender();
    },
  });

  filterRosterPicker(container, 'mm-captain-roster', draftPlayerSearchQuery);

  container.querySelectorAll('[data-mm-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      teamsMode = btn.dataset.mmMode;
      ctx.rerender();
    });
  });

  const capTeamCountField = (event) => {
    teamCountValue = capTeamCountValue(event.target.value, checkedIds.size);
    if (event.target.value !== teamCountValue) event.target.value = teamCountValue;
  };
  container.querySelector('#mm-teamcount')?.addEventListener('input', capTeamCountField);
  // A realtime re-render while this field is focused writes the value typed
  // before it back without an input event — even when the roster has shrunk
  // below it in the meantime. Re-apply the cap to that restored value.
  container.querySelector('#mm-teamcount')?.addEventListener(RESTORE_FOCUS_EVENT, capTeamCountField);

  container.querySelector('#draft-start')?.addEventListener('click', async () => {
    const captainIds = [...draftCaptainIds];
    const poolPlayerIds = [...draftPlayerIds].filter((id) => !draftCaptainIds.has(id));
    try {
      draftCache = await api.draft.start({
        gameId: selectedGameId,
        captainIds,
        poolPlayerIds,
        bettingAllowed: !canOfferBetting() || bettingAllowed,
      });
      draftCaptainIds = new Set();
      bettingAllowed = true;
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  wireSearchSelect(container, 'mm-game', gameSelectOptions);
  container.querySelector('#mm-game').addEventListener('change', (event) => {
    state.selectedGameId = event.target.value;
    ctx.rerender();
  });

  container.querySelector('#mm-avoid-adjacent')?.addEventListener('change', (e) => {
    avoidAdjacentOpponents = e.target.checked;
  });
  container.querySelectorAll('#mm-betting-allowed, #draft-betting-allowed').forEach((input) => {
    input.addEventListener('change', () => { bettingAllowed = input.checked; });
  });

  container.querySelector('#mm-generate')?.addEventListener('click', async () => {
    const gameId = selectedGameId;
    const playerIds = [...checkedIds];
    const teamCountRaw = capTeamCountValue(container.querySelector('#mm-teamcount').value, playerIds.length);
    const body = { gameId, playerIds, avoidAdjacentOpponents,
      bettingAllowed: !canOfferBetting() || bettingAllowed };
    if (teamCountRaw) {
      body.teamCount = parseInt(teamCountRaw, 10);
    }
    // Drawing the same game and roster again discards the unplayed draw shown
    // above, so its open betting market closes instead of lingering.
    const previous = state.lastMatchmaking;
    const previousIds = previous?.teams?.flatMap((team) => team.players.map((player) => player.id)).sort() ?? [];
    if (previous && !previous.matchId && !previous.tournamentId && previous.gameId === gameId
      && previousIds.join() === [...playerIds].sort().join()) {
      body.replacesDrawId = previous.id;
    }

    try {
      const result = await api.matchmaking.generate(body);
      state.lastMatchmaking = result;
      bettingAllowed = true;
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}

function renderResult(result) {
  // Once a result is recorded, this draw stays in Historie with result
  // actions while the "Neue Auslosung" panel has nothing left to show.
  if (!result || result.matchId || result.tournamentId) return '';
  return `
    <section class="matchmaking-new-draw" aria-labelledby="matchmaking-new-draw-title">
      <h2 id="matchmaking-new-draw-title" class="matchmaking-new-draw-title">Neue Auslosung</h2>
      ${renderDrawCard(result, { editable: true, showGame: true })}
    </section>
  `;
}
