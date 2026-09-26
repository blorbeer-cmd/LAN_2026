// "Spiele" view: the one place for everything about a game — suggest it, see
// who's how much "Bock" hat and how skilled the group rates itself, and (via
// the "Verwaltung" section in the detail modal) the admin-side setup that
// used to live in a separate Einstellungen page (process names, team size).
// Bock/Skill are edited right in the row with the shared 0-5 number scale
// (ratingScale.js) — so "was ist mein Bock/Skill, was ist der Schnitt" is visible
// without a detour through the profile. See server/CLAUDE.md games reorg.

import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { suggestProcessNames } from '../gameProcessSuggestions.js';
import { getMyId } from '../whoami.js';
import { domainIcon } from '../domainIcons.js';
import { withStepUp } from '../reauth.js';
import { GAME_GENRES, MAX_GENRES_PER_GAME } from '../gameGenres.js';
import { wireSelectionSearch } from '../selectionSearch.js';
import { emptyStateHtml } from '../emptyState.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { wireActionMenus } from '../actionMenu.js';
import { ratingScaleHtml } from '../ratingScale.js';
import {
  isOnboardingRatingActive,
  onboardingRatingIds,
  onboardingRatingProgress,
  focusOnboardingRatingControl,
  refreshOnboardingRatingProgress,
  syncOnboardingRatingCandidates,
} from '../onboarding.js';

// 'catalog' = the accepted games (everything that is not a suggestion, the
// only ones Vote/Turnier/Auslosung offer), 'suggestions' = the pool waiting
// to be accepted, 'all' = both in one list with suggestions still marked by
// their Vorschlag badge.
let activeTab = 'catalog'; // 'catalog' | 'suggestions' | 'all'
let sortKey = 'name';
let sortDir = 'asc';
let sortMenuOpen = false;
// Genre chip filter for the list (OR semantics: a game matches if it has at
// least one of the selected genres). Empty set means "no filter, show all".
let genreFilter = new Set();
// Independent facets ('bock', 'skill'): AND semantics across the two - if
// both are active, only games missing *both* of the current identity's own
// ratings stay visible, since each is its own separate condition to satisfy
// (unlike genreFilter's alternative-values-of-one-facet OR).
let ratingFilter = new Set();
let filterMenuOpen = false;
// Free-text filter, same component/pattern as the Neue-Abstimmung game
// picker in votes.js — hides already-rendered rows client-side instead of
// re-filtering and re-rendering on every keystroke.
let gameSearchQuery = '';

function sameGenres(a, b) {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((g) => setA.has(g));
}

// No dedicated fetch/cache here on purpose for games/skills/preferences:
// they're all already part of the app-wide loadAll() round trip (see
// data.js) and kept fresh via the existing games:changed/skills:changed/
// preferences:changed socket handlers in app.js — this view just reads
// straight from `state`. Skill suggestions (derived from match results,
// see skillSuggestion.ts) are their own read-only fetch since they aren't
// part of loadAll() — cheap to recompute, but no realtime push exists for
// them, so a stale suggestion just self-corrects next time this view opens.
let suggestionsCache = null;
let suggestionsLoading = false;
// Bumped on every invalidation so an in-flight loadSuggestions() can tell it
// was superseded (e.g. a second match got recorded while the first fetch —
// which only saw one — was still in the air) and must not cache its now-
// stale result: several leaderboard:changed events firing in quick
// succession (a burst of match results) would otherwise let the *last*
// in-flight response win regardless of which invalidation it actually
// answers, permanently missing whatever changed after it was sent — nothing
// else would ever trigger a follow-up fetch.
let suggestionsEpoch = 0;

// A rating write is async; a socket-triggered re-render landing before it
// settles would repaint the row from not-yet-updated state, so the pressed
// number would flash back to the old one. Renders wait until the write is done
// and then catch up once. focusAfterRender keeps keyboard focus on the
// pressed number across that re-render.
let ratingSaving = false;
let focusAfterRender = null;
let lastCtx = null;

// Called from app.js whenever a leaderboard:changed event reports a match
// result was recorded/edited/deleted — the suggestion is derived from match
// history, so a stale cache would keep showing yesterday's numbers.
export function invalidateSkillSuggestions() {
  suggestionsCache = null;
  suggestionsEpoch += 1;
}

export function focusGameCatalog(gameId) {
  const game = state.games.find((entry) => entry.id === gameId);
  if (!game) return;
  // "Alle" already contains every game, suggestion or not — switching tabs
  // there would only take the user out of the list they chose.
  if (activeTab === 'all') return;
  activeTab = game.isSuggestion ? 'suggestions' : 'catalog';
}

async function loadSuggestions(ctx) {
  suggestionsLoading = true;
  const epoch = suggestionsEpoch;
  try {
    const res = await api.skills.suggestions();
    // Another invalidation landed while this request was in flight — its
    // result reflects a moment that's already outdated, so leave the cache
    // null instead of caching stale data: the render this rerender() call
    // triggers below will see the null cache and fetch again itself.
    if (epoch === suggestionsEpoch) suggestionsCache = res.suggestions;
  } catch {
    if (epoch === suggestionsEpoch) suggestionsCache = [];
  } finally {
    suggestionsLoading = false;
    ctx.rerender();
  }
}

function suggestionFor(gameId, playerId) {
  if (!playerId) return null;
  return (suggestionsCache || []).find((s) => s.gameId === gameId && s.playerId === playerId) ?? null;
}

function ratingStats(rows, gameId) {
  const matching = rows.filter((r) => r.game_id === gameId);
  if (matching.length === 0) return { avg: null, count: 0 };
  const avg = matching.reduce((sum, r) => sum + r.rating, 0) / matching.length;
  return { avg, count: matching.length };
}

function myRating(rows, playerId, gameId) {
  const entry = rows.find((r) => r.player_id === playerId && r.game_id === gameId);
  return entry ? entry.rating : null;
}

function sortValue(game, key, myId) {
  if (key === 'avgBock') return ratingStats(state.preferences, game.id).avg ?? -1;
  if (key === 'avgSkill') return ratingStats(state.skills, game.id).avg ?? -1;
  if (key === 'myBock') return myRating(state.preferences, myId, game.id) ?? -1;
  return game.name;
}

function sortedGames(games, myId) {
  return [...games].sort((a, b) => {
    const av = sortValue(a, sortKey, myId);
    const bv = sortValue(b, sortKey, myId);
    const diff = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'de');
    return sortDir === 'asc' ? diff : -diff;
  });
}

// Each option includes its direction. The toolbar therefore needs only one
// stable control instead of a row of buttons whose second click reverses
// the current direction.
const SORT_OPTIONS = [
  { key: 'name', asc: 'Name · A–Z', desc: 'Name · Z–A' },
  { key: 'myBock', asc: 'Mein Bock · ↑', desc: 'Mein Bock · ↓' },
  { key: 'avgBock', asc: 'Ø Bock · ↑', desc: 'Ø Bock · ↓' },
  { key: 'avgSkill', asc: 'Ø Skill · ↑', desc: 'Ø Skill · ↓' },
];

function sortChoices() {
  return SORT_OPTIONS.flatMap(({ key, asc, desc }) => [
    { value: `${key}:asc`, label: asc },
    { value: `${key}:desc`, label: desc },
  ]);
}

function selectedSortLabel() {
  return sortChoices().find(({ value }) => value === `${sortKey}:${sortDir}`)?.label ?? 'Name · A–Z';
}

function sortOptionsHtml() {
  return sortChoices()
    .map(({ value, label }) => {
      const active = value === `${sortKey}:${sortDir}`;
      if (active) {
        return `<button type="button" class="btn btn-sm game-catalog-sort-option is-active" data-sort-value="${value}" aria-pressed="true">${label}</button>`;
      }
      return `<button type="button" class="btn btn-sm game-catalog-sort-option" data-sort-value="${value}" aria-pressed="false">${label}</button>`;
    })
    .join('');
}

// The process suggestion chip: only rendered once there's actually a suggestion
// for this player+game (see suggestionFor/loadSuggestions above). Deliberately
// plain — no pill background/border — so it reads as part of the label line
// next to the Ø note instead of another button competing with the ratings;
// see .skill-suggestion-chip. Highlighted when it diverges from the player's
// own self-rating by 2+ points — a gentle nudge to reconsider, not a claim
// that the derived number is "more right".
function suggestionChipHtml(gameId, suggestion, mine) {
  if (!suggestion) return '';
  const diverges = mine !== null && Math.abs(suggestion.rating - mine) >= 2;
  const winRatePercent = suggestion.gamesPlayed > 0 ? Math.round((suggestion.wins / suggestion.gamesPlayed) * 100) : 0;
  return `
    <button
      type="button"
      class="skill-suggestion-chip ${diverges ? 'skill-suggestion-chip-diverges' : ''}"
      data-apply-suggestion="${gameId}"
      data-suggested-rating="${suggestion.rating}"
      title="Aus ${suggestion.matchCount} Ergebnissen (${winRatePercent}% Siege) – antippen zum Übernehmen"
    >${icon('brain', { className: 'skill-suggestion-icon' })} ${suggestion.rating}</button>`;
}

// Bock and Skill share the 0-5 number scale of Vote and Umfragen. No number
// selected means "not rated yet"; 0 is a deliberate answer (for Bock: kein
// Bock).
function ratingRowHtml({ label, mine, avg, count, gameId, gameName, kind, disabled, suggestionHtml }) {
  const avgText = avg === null ? '' : `Ø ${avg.toFixed(1)} (${count})`;
  const groupLabel = kind === 'bock' ? `Bock auf ${gameName}` : `Skill in ${gameName}`;
  return `
    <div class="skill-row" data-game="${gameId}" data-kind="${kind}">
      <span class="row" style="gap:var(--space-2);flex-wrap:wrap;">
        ${label} <span class="muted game-avg-note">${avgText}</span> ${suggestionHtml || ''}
      </span>
      ${ratingScaleHtml({
        selected: mine,
        groupLabel: mine == null ? `${groupLabel} – noch nicht bewertet` : groupLabel,
        valueLabel: (value) => (kind === 'bock' && value === 0 ? '0 von 5, kein Bock' : `${value} von 5`),
        attributes: (value) => `data-rating-value="${value}"`,
        disabled,
      })}
    </div>`;
}

function gameLinksHtml(game) {
  const links = [
    game.platform_url ? { href: game.platform_url, label: `${icon('squareArrowOutUpRight')} ${game.platform || 'Plattform'}` } : null,
    game.trailer_url ? { href: game.trailer_url, label: `${icon('monitorPlay')} Trailer` } : null,
  ].filter(Boolean);
  if (links.length === 0) return `<span class="muted">Keine Links hinterlegt.</span>`;
  return `
    <div class="row" style="gap:var(--space-2);flex-wrap:wrap;">
      ${links
        .map(
          (l) =>
            `<a class="chip" href="${escapeHtml(l.href)}" target="_blank" rel="noopener noreferrer">${l.label}</a>`
        )
        .join('')}
    </div>`;
}

// Icon-only quick actions right in the row: a static "trackbar" marker (only
// once a process name is mapped — the whole reason Live-Status works for
// this game at all), jump to the store page and watch the trailer. The game
// name itself opens the details. The external links come first and the
// trackbar marker closes the compact group directly beside the game details.
function gameRowIconsHtml(game) {
  const links = [
    game.platform_url
      ? { href: game.platform_url, label: `${game.platform || 'Plattform'}-Link öffnen`, name: 'squareArrowOutUpRight' }
      : null,
    game.trailer_url ? { href: game.trailer_url, label: 'Trailer ansehen', name: 'monitorPlay' } : null,
  ].filter(Boolean);
  // Reuses the same green already used for "spielt"/"trackt gerade"
  // elsewhere, so the color itself carries the meaning at a glance.
  const trackIndicator =
    game.processNames.length > 0
      ? `<span class="game-track-indicator" title="Trackbar – Prozessname hinterlegt" aria-label="Trackbar">${icon('radioTower')}</span>`
      : '';
  const linkIcons = links
    .map(
      (l) =>
        `<a class="game-icon-btn" href="${escapeHtml(l.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(l.label)}" aria-label="${escapeHtml(l.label)}">${icon(l.name)}</a>`
    )
    .join('');
  return `<span class="game-row-links">${linkIcons}${trackIndicator}</span>`;
}

function gameRowHtml(game, myId, showSuggestionBadge, onboardingRequired = false) {
  const bockStats = ratingStats(state.preferences, game.id);
  const skillStats = ratingStats(state.skills, game.id);
  const myBock = myId ? myRating(state.preferences, myId, game.id) : null;
  const mySkill = myId ? myRating(state.skills, myId, game.id) : null;

  const bockRow = ratingRowHtml({
    label: `${icon('flame')} Bock`,
    mine: myBock,
    avg: bockStats.avg,
    count: bockStats.count,
    gameId: game.id,
    gameName: game.name,
    kind: 'bock',
    disabled: !myId,
  });

  // Suggestions carry both meters just like catalog games: how good the group
  // already is at a game is part of deciding whether to accept it at all, so
  // the Skill rating stays available before the promotion too.
  const skillRow = ratingRowHtml({
    label: `${icon(domainIcon('skill'))} Skill`,
    mine: mySkill,
    avg: skillStats.avg,
    count: skillStats.count,
    gameId: game.id,
    gameName: game.name,
    kind: 'skill',
    disabled: !myId,
    suggestionHtml: suggestionChipHtml(game.id, suggestionFor(game.id, myId), mySkill),
  });

  // Only the mixed "Alle" list needs the marker — in the two single-status
  // tabs every row would carry the same badge, which says nothing. The badge
  // itself is icon-only (an accessible name covers screen readers, a native
  // title covers mouse hover) and the row picks up a matching border tint
  // via .is-suggestion, so the status doesn't rely on reading a spelled-out
  // "Vorschlag" label at a glance.
  const isMarkedSuggestion = showSuggestionBadge && game.isSuggestion;
  const suggestionBadge = isMarkedSuggestion
    ? `<span class="badge badge-paused game-row-status-badge" title="Vorschlag">${icon('lightbulb', { label: 'Vorschlag' })}</span>`
    : '';

  return `
    <div class="card game-table-row${isMarkedSuggestion ? ' is-suggestion' : ''}${onboardingRequired ? ' onboarding-required' : ''}" data-search-game="${game.id}" data-game-catalog-search-item data-selection-search="${escapeHtml(game.name)}">
      <div class="game-row-name">
        <button type="button" class="btn btn-sm game-row-detail-trigger" data-detail="${game.id}">${escapeHtml(game.name)}</button>
        ${onboardingRequired ? '<span class="badge badge-playing onboarding-required-badge">Pflicht</span>' : ''}
        ${suggestionBadge}
        ${gameRowIconsHtml(game)}
        ${game.genres?.length ? `<span class="muted game-row-genre">${escapeHtml(game.genres.join(', '))}</span>` : ''}
      </div>
      <div class="game-row-sliders">
        <div class="game-row-bock">${bockRow}</div>
        <div class="game-row-skill">${skillRow}</div>
      </div>
    </div>`;
}

function openSuggestForm(ctx) {
  const myId = getMyId();
  if (!myId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });

  const selectedGenres = new Set();
  let modalEl;
  const { close } = openModal(
    'Spiel vorschlagen',
    `
      <form id="suggest-form" class="stack">
        <div>
          <label class="field-label is-required" for="suggest-title">Titel</label>
          <input type="text" id="suggest-title" maxlength="60" placeholder="Rocket League" required autofocus />
        </div>
        <div>
          <label class="field-label" for="suggest-platform">Plattform</label>
          <input type="text" id="suggest-platform" maxlength="80" placeholder="Steam" />
        </div>
        <div>
          <label class="field-label" for="suggest-platform-url">Plattform-Link</label>
          <input type="url" id="suggest-platform-url" maxlength="500" placeholder="https://" />
        </div>
        <div>
          <label class="field-label" for="suggest-trailer">YouTube-Gameplay-Link</label>
          <input type="url" id="suggest-trailer" maxlength="500" placeholder="Leer lassen für automatische Suche" />
        </div>
        <div>
          <span class="field-label" id="suggest-genre-label">Genre</span>
          <div class="chip-list" role="group" aria-labelledby="suggest-genre-label" id="suggest-genre-chips">${genreChipsHtml(selectedGenres)}</div>
        </div>
        <div class="game-detail-info-field">
          <label class="field-label" for="suggest-info">Info</label>
          <textarea id="suggest-info" rows="1" maxlength="300" placeholder="Braucht einen Controller"></textarea>
        </div>
        <div class="check-row game-detail-seat-option">
          <input type="checkbox" id="suggest-consider-seat-neighbors" />
          <span class="title-with-info tournament-option-label">
            <label for="suggest-consider-seat-neighbors">Sitznachbarn bei Auslosung</label>
            ${infoTooltipHtml(
              'suggest-consider-seat-neighbors-help',
              'Sitznachbarn bei Auslosung',
              'Voreinstellung für die Teams-Auslosung: Ist dieses Spiel ausgewählt, startet „Sitznachbarn“ dort mit diesem Wert. Lässt sich bei jeder Auslosung weiterhin einzeln umschalten.',
            )}
          </span>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Vorschlagen</button>
      </form>
    `,
    {
      confirmClose: () => {
        if (!modalEl) return null;
        const values = ['#suggest-title', '#suggest-platform', '#suggest-platform-url', '#suggest-trailer', '#suggest-info'].map(
          (sel) => modalEl.querySelector(sel).value.trim(),
        );
        return values.some(Boolean) || selectedGenres.size || modalEl.querySelector('#suggest-consider-seat-neighbors').checked
          ? 'Deine Angaben zum Spielvorschlag gehen verloren.'
          : null;
      },
      onMount: (el) => {
        modalEl = el;
        wireInfoTooltips(el);
        el.querySelectorAll('[data-genre-toggle]').forEach((chip) => {
          chip.addEventListener('click', () => {
            const genre = chip.dataset.genreToggle;
            if (selectedGenres.has(genre)) {
              selectedGenres.delete(genre);
            } else {
              if (selectedGenres.size >= MAX_GENRES_PER_GAME) {
                showToast(`Maximal ${MAX_GENRES_PER_GAME} Genres auswählen.`, { error: true });
                return;
              }
              selectedGenres.add(genre);
            }
            const active = selectedGenres.has(genre);
            chip.classList.toggle('is-active', active);
            chip.setAttribute('aria-pressed', String(active));
          });
        });
        el.querySelector('#suggest-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = el.querySelector('#suggest-title').value.trim();
          if (!name) return;
          try {
            await api.games.create({
              name,
              status: 'suggestion',
              platform: el.querySelector('#suggest-platform').value.trim() || null,
              platformUrl: el.querySelector('#suggest-platform-url').value.trim() || null,
              trailerUrl: el.querySelector('#suggest-trailer').value.trim() || null,
              genres: [...selectedGenres],
              info: el.querySelector('#suggest-info').value.trim() || null,
              considerSeatNeighborsDefault: el.querySelector('#suggest-consider-seat-neighbors').checked,
              playerId: myId,
            });
            close();
            activeTab = 'suggestions';
            await ctx.refresh();
            showToast('Vorschlag eingetragen.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

function genreChipsHtml(selectedGenres) {
  return GAME_GENRES.map(
    (g) =>
      `<button type="button" class="chip${selectedGenres.has(g) ? ' is-active' : ''}" data-genre-toggle="${escapeHtml(g)}" aria-pressed="${selectedGenres.has(g)}">${escapeHtml(g)}</button>`,
  ).join('');
}

function openGameDetail(gameId, ctx) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return;

  const selectedGenres = new Set(game.genres ?? []);

  const processChips = game.processNames
    .map(
      (pn) => `
      <span class="chip">${escapeHtml(pn)} <button type="button" class="icon-btn" data-remove-proc="${escapeHtml(pn)}" aria-label="Entfernen">${icon('x')}</button></span>`
    )
    .join('');
  const suggestedProcessNames = game.processNames.length === 0 ? suggestProcessNames(game.name) : [];

  let modalEl;
  const { close } = openModal(
    game.name,
    `
      <div class="stack">
        <div class="row" style="align-items:center;">
                    <input type="text" id="edit-name" value="${escapeHtml(game.name)}" maxlength="60" style="flex:1;" placeholder="Rocket League" />
        </div>
        ${gameLinksHtml(game)}
        <div>
          <label class="field-label" for="edit-platform">Plattform</label>
          <input type="text" id="edit-platform" maxlength="80" value="${escapeHtml(game.platform ?? '')}" placeholder="Steam" />
        </div>
        <div>
          <label class="field-label" for="edit-platform-url">Plattform-Link</label>
          <input type="url" id="edit-platform-url" maxlength="500" value="${escapeHtml(game.platform_url ?? '')}" placeholder="https://" />
        </div>
        <div>
          <label class="field-label" for="edit-trailer">${game.isSuggestion ? 'YouTube-Gameplay-Link' : 'Gameplay-Trailer'}</label>
          <input type="url" id="edit-trailer" maxlength="500" value="${escapeHtml(game.trailer_url ?? '')}" placeholder="${game.isSuggestion ? 'Leer lassen für automatische Suche' : 'https://'}" />
        </div>
        <div>
          <span class="field-label" id="edit-genre-label">Genre</span>
          <div class="chip-list" role="group" aria-labelledby="edit-genre-label" id="edit-genre-chips">${genreChipsHtml(selectedGenres)}</div>
        </div>
        <div class="game-detail-info-field">
          <label class="field-label" for="edit-info">Info</label>
          <textarea id="edit-info" rows="1" maxlength="300" placeholder="Braucht einen Controller">${escapeHtml(game.info ?? '')}</textarea>
        </div>
        <div class="check-row game-detail-seat-option">
          <input type="checkbox" id="edit-consider-seat-neighbors" ${game.considerSeatNeighborsDefault ? 'checked' : ''} />
          <span class="title-with-info tournament-option-label">
            <label for="edit-consider-seat-neighbors">Sitznachbarn bei Auslosung</label>
            ${infoTooltipHtml(
              'edit-consider-seat-neighbors-help',
              'Sitznachbarn bei Auslosung',
              'Voreinstellung für die Teams-Auslosung: Ist dieses Spiel ausgewählt, startet „Sitznachbarn“ dort mit diesem Wert. Lässt sich bei jeder Auslosung weiterhin einzeln umschalten.',
            )}
          </span>
        </div>

        <div class="section-title game-detail-process-title">Prozessname</div>
        <div class="chip-list">${processChips || '<span class="muted">Noch keine Prozessnamen.</span>'}</div>
        ${
          suggestedProcessNames.length
            ? `<button type="button" class="btn btn-sm" id="use-suggested-process" style="align-self:flex-start;">${icon('lightbulb')} Vorschlag übernehmen: ${escapeHtml(suggestedProcessNames.join(', '))}</button>`
            : ''
        }
        <div class="row" style="align-items:stretch;">
          <input type="text" id="new-process" placeholder="cs2.exe" style="flex:1;" aria-label="Prozessname" />
          <button type="button" class="btn" id="add-process">+</button>
        </div>

        <button type="button" class="btn btn-primary btn-block" id="edit-save">Speichern</button>
        ${
          game.isSuggestion
            ? `<button type="button" class="btn btn-primary btn-block" id="edit-promote">In Katalog übernehmen</button>`
            : `<button type="button" class="btn btn-block" id="edit-demote">Zurück zu Vorschlägen</button>`
        }
        <button type="button" class="btn btn-danger btn-block" id="edit-delete">Spiel löschen</button>
      </div>
    `,
    {
      confirmClose: () => {
        if (!modalEl) return null;
        const name = modalEl.querySelector('#edit-name').value.trim();
        const platform = modalEl.querySelector('#edit-platform').value.trim();
        const platformUrl = modalEl.querySelector('#edit-platform-url').value.trim();
        const trailerUrl = modalEl.querySelector('#edit-trailer').value.trim();
        const info = modalEl.querySelector('#edit-info').value.trim();
        const considerSeatNeighborsDefault = modalEl.querySelector('#edit-consider-seat-neighbors').checked;
        const newProcess = modalEl.querySelector('#new-process').value.trim();
        const dirty =
          name !== (game.name ?? '') ||
          platform !== (game.platform ?? '') ||
          platformUrl !== (game.platform_url ?? '') ||
          trailerUrl !== (game.trailer_url ?? '') ||
          !sameGenres([...selectedGenres], game.genres ?? []) ||
          info !== (game.info ?? '') ||
          considerSeatNeighborsDefault !== Boolean(game.considerSeatNeighborsDefault) ||
          Boolean(newProcess);
        return dirty
          ? `Deine Änderungen am Spiel (Name, Plattform, Prozessname und ${game.isSuggestion ? 'YouTube-Link' : 'Trailer-Link'}) werden nicht gespeichert.`
          : null;
      },
      onMount: (el) => {
        modalEl = el;
        wireInfoTooltips(el);
        el.querySelectorAll('[data-genre-toggle]').forEach((chip) => {
          chip.addEventListener('click', () => {
            const g = chip.dataset.genreToggle;
            if (selectedGenres.has(g)) {
              selectedGenres.delete(g);
            } else {
              if (selectedGenres.size >= MAX_GENRES_PER_GAME) {
                showToast(`Maximal ${MAX_GENRES_PER_GAME} Genres auswählen.`, { error: true });
                return;
              }
              selectedGenres.add(g);
            }
            const active = selectedGenres.has(g);
            chip.classList.toggle('is-active', active);
            chip.setAttribute('aria-pressed', String(active));
          });
        });
        el.querySelector('#edit-save').addEventListener('click', async () => {
          const name = el.querySelector('#edit-name').value.trim();
          const platform = el.querySelector('#edit-platform').value.trim();
          const platformUrl = el.querySelector('#edit-platform-url').value.trim();
          const trailerUrl = el.querySelector('#edit-trailer').value.trim();
          const info = el.querySelector('#edit-info').value.trim();
          const considerSeatNeighborsDefault = el.querySelector('#edit-consider-seat-neighbors').checked;
          try {
            await api.games.update(gameId, {
              name,
              platform: platform || null,
              platformUrl: platformUrl || null,
              trailerUrl: trailerUrl || null,
              genres: [...selectedGenres],
              info: info || null,
              considerSeatNeighborsDefault,
            });
            close();
            await ctx.refresh();
            showToast('Gespeichert.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });

        el.querySelector('#edit-promote')?.addEventListener('click', async () => {
          try {
            await api.games.promote(gameId);
            close();
            activeTab = 'catalog';
            await ctx.refresh();
            showToast('Spiel in den Katalog übernommen.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });

        el.querySelector('#edit-demote')?.addEventListener('click', async () => {
          try {
            await api.games.demote(gameId);
            close();
            await ctx.refresh();
            showToast('Spiel zurück in die Vorschlagsliste verschoben.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });

        el.querySelector('#add-process').addEventListener('click', async () => {
          const input = el.querySelector('#new-process');
          const value = input.value.trim();
          if (!value) return;
          try {
            await api.games.addProcess(gameId, value);
            input.value = '';
            close();
            await ctx.refresh();
            openGameDetail(gameId, ctx);
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });

        const suggestBtn = el.querySelector('#use-suggested-process');
        if (suggestBtn) {
          suggestBtn.addEventListener('click', async () => {
            try {
              for (const processName of suggestedProcessNames) {
                await api.games.addProcess(gameId, processName);
              }
              close();
              await ctx.refresh();
              openGameDetail(gameId, ctx);
            } catch (err) {
              showToast(err.message, { error: true });
            }
          });
        }

        el.querySelectorAll('[data-remove-proc]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            try {
              await api.games.removeProcess(gameId, btn.dataset.removeProc);
              close();
              await ctx.refresh();
              openGameDetail(gameId, ctx);
            } catch (err) {
              showToast(err.message, { error: true });
            }
          });
        });

        el.querySelector('#edit-delete').addEventListener('click', async () => {
          if (!(await confirmDialog(`${game.name} wirklich löschen? Skill-/Bock-Wertungen und Ergebnisse dazu gehen verloren.`, { confirmText: 'Löschen', danger: true }))) return;
          try {
            const removed = await withStepUp(() => api.games.remove(gameId));
            if (removed === undefined) return;
            close();
            await ctx.refresh();
            showToast('Spiel gelöscht.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

export function renderGameCatalog(container, ctx) {
  lastCtx = ctx;
  if (ratingSaving) return;

  if (suggestionsCache === null && !suggestionsLoading) loadSuggestions(ctx);

  const myId = getMyId();
  const ratingMode = isOnboardingRatingActive();
  // A number that holds keyboard focus keeps it across a realtime re-render.
  const focusedRating = document.activeElement?.closest?.('.skill-row [data-rating-value]');
  const focusedRatingTarget = focusedRating
    ? { gameId: focusedRating.closest('.skill-row').dataset.game, kind: focusedRating.closest('.skill-row').dataset.kind, rating: Number(focusedRating.dataset.ratingValue) }
    : null;
  if (ratingMode) void syncOnboardingRatingCandidates();
  const ratingIds = onboardingRatingIds();
  const requiredRatingIds = new Set(ratingIds.slice(0, 10));
  const tabGames = state.games.filter((g) => {
    if (ratingMode) return !g.isSuggestion;
    if (activeTab === 'suggestions') return g.isSuggestion;
    if (activeTab === 'catalog') return !g.isSuggestion;
    return true;
  });
  const games = tabGames
    .filter((g) => ratingMode || genreFilter.size === 0 || (g.genres ?? []).some((genre) => genreFilter.has(genre)))
    .filter((g) => {
      if (ratingMode || !myId || ratingFilter.size === 0) return true;
      if (ratingFilter.has('bock') && myRating(state.preferences, myId, g.id) !== null) return false;
      if (ratingFilter.has('skill') && myRating(state.skills, myId, g.id) !== null) return false;
      return true;
    });
  const rows = ratingMode
    ? ratingIds.map((id) => games.find((game) => game.id === id)).filter(Boolean)
    : sortedGames(games, myId);
  const sectionTitle =
    ratingMode ? 'Bewertungen' : activeTab === 'catalog' ? 'Spielekatalog' : activeTab === 'suggestions' ? 'Vorschläge' : 'Alle Spiele';
  const usedGenres = GAME_GENRES.filter((g) => state.games.some((game) => (game.genres ?? []).includes(g)));
  const activeFilterCount = genreFilter.size + ratingFilter.size;
  // Distinguishes a genuinely empty catalog/suggestion pool from "filtered
  // down to nothing" - the rating filter case gets a positive framing since
  // reaching it is the point of using that filter, not an error state.
  const emptyTabMessages = {
    suggestions: 'Noch keine Vorschläge.',
    catalog: 'Noch keine Spiele.',
    all: 'Noch keine Spiele.',
  };
  const emptyMessage =
    tabGames.length === 0
      ? emptyTabMessages[activeTab]
      : ratingFilter.size > 0
        ? 'Alles bewertet – keine offenen Spiele mit diesem Filter.'
        : 'Keine Spiele für diese Filter.';

  // Phones show only a "+" so the button still fits beside the three tabs.
  const suggestButtonHtml = `<button type="button" class="btn btn-primary btn-sm game-catalog-suggest" id="suggest-new" aria-label="Spiel vorschlagen">
      <span class="game-catalog-suggest-label" aria-hidden="true">Spiel vorschlagen</span>
      <span class="game-catalog-suggest-icon" aria-hidden="true">${icon('plus')}</span>
    </button>`;

  container.innerHTML = `
    <div class="row-between page-title-row">
      <h1 class="view-title">Spiele</h1>
    </div>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" ${ratingMode ? 'aria-labelledby="game-catalog-list-title"' : `aria-label="${sectionTitle}"`}>
        ${ratingMode ? `<div class="grouped-page-section-title"><h2 id="game-catalog-list-title">${sectionTitle}</h2>${suggestButtonHtml}</div>` : ''}
        ${ratingMode ? `
          <div class="onboarding-rating-banner" aria-live="polite">
            <div class="onboarding-rating-banner-copy">
              <strong>Pflichtbewertung</strong>
              <span>${onboardingRatingProgress().completed} von ${onboardingRatingProgress().required} Spielen vollständig bewertet. Für jedes Spiel werden Bock und Skill benötigt.</span>
            </div>
          </div>` : ''}
        ${ratingMode ? '' : `<div class="game-catalog-tab-row">
          <div class="tabs game-catalog-tabs">
            <button type="button" class="btn btn-sm ${activeTab === 'catalog' ? 'btn-primary' : ''}" data-tab="catalog">Katalog</button>
            <button type="button" class="btn btn-sm ${activeTab === 'suggestions' ? 'btn-primary' : ''}" data-tab="suggestions">Vorschläge</button>
            <button type="button" class="btn btn-sm ${activeTab === 'all' ? 'btn-primary' : ''}" data-tab="all">Alle</button>
          </div>
          ${suggestButtonHtml}
        </div>`}
        ${ratingMode ? '' : `<section class="game-catalog-toolbar" aria-label="Spiele durchsuchen, sortieren und filtern">
          <input type="search" id="game-catalog-search" value="${escapeHtml(gameSearchQuery)}" placeholder="Spiel suchen" aria-label="Spiele suchen" autocomplete="off" />
          <details class="action-menu game-catalog-sort-menu" ${sortMenuOpen ? 'open' : ''}>
            <summary class="btn btn-sm game-catalog-sort-trigger" aria-label="Spiele sortieren">
              ${selectedSortLabel()} ${icon('chevronDown')}
            </summary>
            <div class="action-menu-panel game-catalog-sort-panel" role="group" aria-label="Spiele sortieren">
              ${sortOptionsHtml()}
            </div>
          </details>
          <details class="action-menu game-catalog-filter-menu" ${filterMenuOpen ? 'open' : ''}>
            <summary class="btn btn-sm game-catalog-filter-trigger" aria-label="Filter öffnen${activeFilterCount > 0 ? `, ${activeFilterCount} aktiv` : ''}">
              Filter${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''} ${icon('chevronDown')}
            </summary>
            <div class="action-menu-panel game-catalog-filter-panel">
              ${
                myId
                  ? `<div class="stack game-catalog-filter-section" role="group" aria-label="Nach fehlender eigener Bewertung filtern">
                       <span class="game-catalog-filter-heading">Offene Bewertungen</span>
                       <div class="chip-list">
                         <button type="button" class="chip${ratingFilter.has('bock') ? ' is-active' : ''}" data-rating-filter="bock" aria-pressed="${ratingFilter.has('bock')}">Bock offen</button>
                         <button type="button" class="chip${ratingFilter.has('skill') ? ' is-active' : ''}" data-rating-filter="skill" aria-pressed="${ratingFilter.has('skill')}">Skill offen</button>
                       </div>
                     </div>`
                  : ''
              }
              ${
                usedGenres.length
                  ? `<div class="stack game-catalog-filter-section" role="group" aria-label="Nach Genre filtern">
                       <span class="game-catalog-filter-heading">Genres</span>
                       <div class="chip-list">
                         ${usedGenres
                           .map(
                             (g) =>
                               `<button type="button" class="chip${genreFilter.has(g) ? ' is-active' : ''}" data-genre-filter="${escapeHtml(g)}" aria-pressed="${genreFilter.has(g)}">${escapeHtml(g)}</button>`,
                           )
                           .join('')}
                       </div>
                     </div>`
                  : ''
              }
              ${
                activeFilterCount > 0
                  ? '<button type="button" class="btn btn-sm game-catalog-filter-reset" data-clear-game-filters>Filter zurücksetzen</button>'
                  : ''
              }
            </div>
          </details>
        </section>`}
        <div class="game-table${ratingMode ? ' onboarding-rating-list' : ''}">
          ${
            rows.length === 0
              ? emptyStateHtml(emptyMessage)
              : rows.map((g) => gameRowHtml(g, myId, activeTab === 'all', ratingMode && requiredRatingIds.has(g.id))).join('')
          }
        </div>
        <p class="muted" data-game-catalog-search-empty role="status" style="font-size:var(--font-size-xs);" hidden>Keine passenden Spiele gefunden.</p>
      </section>
    </div>
  `;


  container.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      ctx.rerender();
    });
  });

  wireActionMenus(container);
  const sortMenu = container.querySelector('.game-catalog-sort-menu');
  sortMenu?.addEventListener('toggle', () => {
    sortMenuOpen = sortMenu.open;
  });
  const filterMenu = container.querySelector('.game-catalog-filter-menu');
  filterMenu?.addEventListener('toggle', () => {
    filterMenuOpen = filterMenu.open;
  });

  wireSelectionSearch(container, {
    inputId: 'game-catalog-search',
    itemSelector: '[data-game-catalog-search-item]',
    emptySelector: '[data-game-catalog-search-empty]',
    onQueryChange: (query) => {
      gameSearchQuery = query;
    },
  });

  container.querySelectorAll('[data-genre-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.genreFilter;
      if (genreFilter.has(g)) genreFilter.delete(g);
      else genreFilter.add(g);
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-rating-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.ratingFilter;
      if (ratingFilter.has(k)) ratingFilter.delete(k);
      else ratingFilter.add(k);
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-sort-value]').forEach((button) => {
    button.addEventListener('click', () => {
      [sortKey, sortDir] = button.dataset.sortValue.split(':');
      sortMenuOpen = false;
      ctx.rerender();
    });
  });

  container.querySelector('[data-clear-game-filters]')?.addEventListener('click', () => {
    genreFilter.clear();
    ratingFilter.clear();
    filterMenuOpen = false;
    ctx.rerender();
  });

  container.querySelector('#suggest-new')?.addEventListener('click', () => openSuggestForm(ctx));

  container.querySelectorAll('[data-detail]').forEach((btn) => {
    btn.addEventListener('click', () => openGameDetail(btn.dataset.detail, ctx));
  });

  container.querySelectorAll('.skill-row [data-rating-value]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.skill-row');
      const gameId = row.dataset.game;
      const kind = row.dataset.kind;
      const rating = Number(btn.dataset.ratingValue);
      focusAfterRender = { gameId, kind, rating };
      ratingSaving = true;
      try {
        if (kind === 'bock') {
          // No ctx.refresh(): the 'preferences:changed' broadcast this
          // triggers (see app.js) already patches state for every
          // connected client, including this one.
          const saved = await api.preferences.set(myId, gameId, rating);
          const existing = state.preferences.find((p) => p.player_id === saved.playerId && p.game_id === saved.gameId);
          if (existing) existing.rating = saved.rating;
          else state.preferences.push({ player_id: saved.playerId, game_id: saved.gameId, rating: saved.rating });
        } else {
          // Still no ctx.refresh() (a full loadAll() + render): PUT
          // /api/skills broadcasts 'skills:changed', which app.js's
          // fullReloadEvents handler already turns into one for every
          // connected client, including this one. Patching state.skills
          // directly from our own successful response keeps the new value
          // on screen even if this client's socket misses that broadcast.
          const saved = await api.skills.set(myId, gameId, rating);
          const existing = state.skills.find((s) => s.player_id === saved.playerId && s.game_id === saved.gameId);
          if (existing) existing.rating = saved.rating;
          else state.skills.push({ player_id: saved.playerId, game_id: saved.gameId, rating: saved.rating });
        }
      } catch (err) {
        showToast(err.message, { error: true });
      } finally {
        ratingSaving = false;
        refreshOnboardingRatingProgress();
        lastCtx?.rerender();
      }
    });
  });

  container.querySelectorAll('[data-apply-suggestion]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!myId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      try {
        await api.skills.set(myId, btn.dataset.applySuggestion, parseInt(btn.dataset.suggestedRating, 10));
        await ctx.refresh();
        showToast('Skill-Vorschlag übernommen.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  // Keeps focus on the number just pressed instead of yanking it - and the
  // page scroll with it - away with every save.
  const pending = focusAfterRender ?? focusedRatingTarget;
  focusAfterRender = null;
  const restored = pending
    ? [...container.querySelectorAll('.skill-row')]
        .find((row) => row.dataset.game === pending.gameId && row.dataset.kind === pending.kind)
        ?.querySelector(`[data-rating-value="${pending.rating}"]`)
    : null;
  if (restored) restored.focus({ preventScroll: true });

  if (ratingMode) {
    // The dialog's counter and finish button must follow the state this render
    // just drew: a realtime reload can bring in ratings after the last save's
    // own refresh ran, and would otherwise leave "x von 10" and a disabled
    // "Abschließen" behind although every required game shows as rated.
    refreshOnboardingRatingProgress();
    // Entering rating mode fresh (nothing was just pressed) starts at the
    // first required rating.
    if (!restored) focusOnboardingRatingControl();
  }
}
