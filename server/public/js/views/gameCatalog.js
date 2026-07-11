// "Spiele" view: the one place for everything about a game — suggest it, see
// who's how much "Bock" hat and how skilled the group rates itself, and (via
// the "Verwaltung" section in the detail modal) the admin-side setup that
// used to live in a separate Einstellungen page (process names, team size).
// Bock/Skill are edited right in the row, same slider component profile.js
// used to own — so "was ist mein Bock/Skill, was ist der Schnitt" is visible
// without a detour through the profile. See server/CLAUDE.md games reorg.

import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { escapeHtml, gameBadgeHtml } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { suggestProcessNames } from '../gameProcessSuggestions.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';

let activeTab = 'catalog'; // 'catalog' | 'suggestions'
let sortKey = 'name';
let sortDir = 'asc';

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

// Guards the Bock/Skill sliders against a socket-triggered re-render (e.g.
// the very 'preferences:changed'/'skills:changed' broadcast a drag's own
// debounced write causes) landing while the user is mid-drag:
// renderGameCatalog replaces container.innerHTML wholesale, which destroys
// the exact <input> the pointer is down on and silently drops the browser's
// native pointer capture for that drag — the thumb then stops tracking the
// mouse, even mid-screen, until released and re-grabbed. Skipping the render
// while a drag is active keeps the live element intact; endDrag() below
// catches up with a single no-network re-render once the drag actually ends.
let sliderDragActive = false;
let dragGuardInstalled = false;
let lastCtx = null;

function ensureDragGuardInstalled() {
  if (dragGuardInstalled) return;
  dragGuardInstalled = true;
  const endDrag = () => {
    if (!sliderDragActive) return;
    sliderDragActive = false;
    lastCtx?.rerender();
  };
  // Listening on document (not the slider) is what catches a release outside
  // the slider's own box — a range input's native drag keeps tracking the
  // pointer anywhere on screen once grabbed. pointerup/pointercancel cover
  // mouse, pen and touch; mouseup/touchend are a fallback for browsers/edge
  // cases without full Pointer Events support.
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  document.addEventListener('mouseup', endDrag);
  document.addEventListener('touchend', endDrag);
}

// Called from app.js whenever a leaderboard:changed event reports a match
// result was recorded/edited/deleted — the suggestion is derived from match
// history, so a stale cache would keep showing yesterday's numbers.
export function invalidateSkillSuggestions() {
  suggestionsCache = null;
}

async function loadSuggestions(ctx) {
  suggestionsLoading = true;
  try {
    const res = await api.skills.suggestions();
    suggestionsCache = res.suggestions;
  } catch {
    suggestionsCache = [];
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

function sortButton(key, label) {
  const mark = sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
  return `<button type="button" class="btn btn-sm" data-sort="${key}">${label}${mark}</button>`;
}

function statusBadgeHtml(game) {
  if (game.isSuggestion) return `<span class="badge badge-paused">${icon('lightbulb')} Vorschlag</span>`;
  if (game.processNames.length > 0) return `<span class="badge badge-playing">getrackt</span>`;
  return `<span class="badge badge-offline">${icon('library')} Katalog</span>`;
}

// The 🧠 suggestion chip: only rendered once there's actually a suggestion
// for this player+game (see suggestionFor/loadSuggestions above). Highlighted
// when it diverges from the player's own self-rating by 2+ points — a gentle
// nudge to reconsider, not a claim that the derived number is "more right".
function suggestionChipHtml(gameId, suggestion, mine) {
  if (!suggestion) return '';
  const diverges = mine !== null && Math.abs(suggestion.rating - mine) >= 2;
  const winRatePercent = suggestion.gamesPlayed > 0 ? Math.round((suggestion.wins / suggestion.gamesPlayed) * 100) : 0;
  return `
    <button
      type="button"
      class="chip chip-suggestion ${diverges ? 'chip-suggestion-diverges' : ''}"
      data-apply-suggestion="${gameId}"
      data-suggested-rating="${suggestion.rating}"
      title="Aus ${suggestion.matchCount} Ergebnissen (${winRatePercent}% Siege) – antippen zum Übernehmen"
    >${icon('brain')} ${suggestion.rating}</button>`;
}

function ratingRowHtml({ label, accentClass, mine, avg, count, gameId, kind, disabled, suggestionHtml }) {
  const avgText = avg === null ? '' : `Ø ${avg.toFixed(1)} (${count})`;
  const sliderValue = mine ?? 5;
  return `
    <div class="skill-row" data-game="${gameId}" data-kind="${kind}">
      <span class="row" style="gap:var(--space-2);flex-wrap:wrap;">
        ${label} <span class="muted game-avg-note">${avgText}</span> ${suggestionHtml || ''}
      </span>
      <span class="skill-value">${mine ?? ''}</span>
      <input type="range" class="skill-row-slider ${accentClass}" min="1" max="10" step="1" value="${sliderValue}" ${disabled ? 'disabled' : ''} />
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

// Icon-only quick actions right in the row: open details, jump to the store
// page, watch the trailer. All rendered as identical square buttons (see
// .game-icon-btn) so the group reads as one tidy unit regardless of which
// icons happen to be present — the full labelled chip versions live in the
// detail modal (gameLinksHtml below). The details button carries the same
// data-detail attribute the old standalone button used, so the existing
// [data-detail] wiring in renderGameCatalog picks it up unchanged.
function gameRowIconsHtml(game) {
  const links = [
    game.platform_url
      ? { href: game.platform_url, label: `${game.platform || 'Plattform'}-Link öffnen`, name: 'squareArrowOutUpRight' }
      : null,
    game.trailer_url ? { href: game.trailer_url, label: 'Trailer ansehen', name: 'monitorPlay' } : null,
  ].filter(Boolean);
  // The info glyph is a circle, which reads visually smaller/thinner than
  // the other two icons' rectilinear glyphs at an identical nominal size —
  // a well-known optical effect with round shapes (same issue type design
  // solves with "overshoot"). game-icon-info compensates with a small size
  // bump so all three end up looking equally weighted.
  const detailBtn = `<button type="button" class="game-icon-btn" data-detail="${game.id}" title="Details" aria-label="Details">${icon('info', { className: 'game-icon-info' })}</button>`;
  const linkIcons = links
    .map(
      (l) =>
        `<a class="game-icon-btn" href="${escapeHtml(l.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(l.label)}" aria-label="${escapeHtml(l.label)}">${icon(l.name)}</a>`
    )
    .join('');
  return `<span class="game-row-links">${detailBtn}${linkIcons}</span>`;
}

function gameRowHtml(game, myId) {
  const bockStats = ratingStats(state.preferences, game.id);
  const skillStats = ratingStats(state.skills, game.id);
  const myBock = myId ? myRating(state.preferences, myId, game.id) : null;
  const mySkill = myId ? myRating(state.skills, myId, game.id) : null;

  return `
    <div class="card game-table-row">
      <div class="game-row-name">
        ${gameBadgeHtml(game, 28)}
        <strong class="game-row-title">${escapeHtml(game.name)}</strong>
        ${gameRowIconsHtml(game)}
      </div>
      <div class="game-row-sliders">
        <div class="game-row-bock">
          ${ratingRowHtml({
            label: `${icon('flame')} Bock`,
            accentClass: 'preference-row-slider',
            mine: myBock,
            avg: bockStats.avg,
            count: bockStats.count,
            gameId: game.id,
            kind: 'bock',
            disabled: !myId,
          })}
        </div>
        <div class="game-row-skill">
          ${
            game.isSuggestion
              ? '' /* no skill rating for a suggestion yet — Promote/Delete live in the detail modal (via the info icon) instead */
              : ratingRowHtml({
                  label: `${icon('swords')} Skill`,
                  accentClass: '',
                  mine: mySkill,
                  avg: skillStats.avg,
                  count: skillStats.count,
                  gameId: game.id,
                  kind: 'skill',
                  disabled: !myId,
                  suggestionHtml: suggestionChipHtml(game.id, suggestionFor(game.id, myId), mySkill),
                })
          }
        </div>
      </div>
    </div>`;
}

function openSuggestForm(ctx) {
  const myId = getMyId();
  if (!myId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });

  const { close } = openModal(
    'Spiel vorschlagen',
    `
      <form id="suggest-form" class="stack">
        <div>
          <label class="field-label" for="suggest-title">Titel</label>
          <input type="text" id="suggest-title" maxlength="60" required autofocus />
        </div>
        <div>
          <label class="field-label" for="suggest-platform">Plattform</label>
          <input type="text" id="suggest-platform" maxlength="80" placeholder="Steam, Epic, Battle.net…" />
        </div>
        <div>
          <label class="field-label" for="suggest-trailer">Gameplay-Trailer</label>
          <input type="url" id="suggest-trailer" maxlength="500" placeholder="https://…" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Vorschlagen</button>
      </form>
    `,
    {
      onMount: (el) => {
        el.querySelector('#suggest-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = el.querySelector('#suggest-title').value.trim();
          if (!name) return;
          try {
            await api.games.create({
              name,
              status: 'suggestion',
              platform: el.querySelector('#suggest-platform').value.trim() || null,
              trailerUrl: el.querySelector('#suggest-trailer').value.trim() || null,
              playerId: myId,
            });
            close();
            await ctx.refresh();
            activeTab = 'suggestions';
            ctx.rerender();
            showToast('Vorschlag eingetragen.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

function openGameDetail(gameId, ctx) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return;

  const processChips = game.processNames
    .map(
      (pn) => `
      <span class="chip">${escapeHtml(pn)} <button type="button" class="icon-btn" data-remove-proc="${escapeHtml(pn)}" aria-label="Entfernen" style="font-size:var(--font-size-xs);padding:0 2px;">✕</button></span>`
    )
    .join('');
  const suggestedProcessNames = game.processNames.length === 0 ? suggestProcessNames(game.name) : [];

  const { close } = openModal(
    escapeHtml(game.name),
    `
      <div class="stack">
        <div class="row" style="align-items:center;">
          ${gameBadgeHtml(game, 56)}
          <input type="text" id="edit-name" value="${escapeHtml(game.name)}" maxlength="60" style="flex:1;" />
        </div>
        <div class="row" style="gap:var(--space-2);flex-wrap:wrap;align-items:center;">
          ${statusBadgeHtml(game)}
        </div>
        ${gameLinksHtml(game)}
        <div>
          <label class="field-label" for="edit-platform">Plattform</label>
          <input type="text" id="edit-platform" maxlength="80" value="${escapeHtml(game.platform ?? '')}" placeholder="Steam, Epic, Battle.net…" />
        </div>
        <div>
          <label class="field-label" for="edit-platform-url">Plattform-Link</label>
          <input type="url" id="edit-platform-url" maxlength="500" value="${escapeHtml(game.platform_url ?? '')}" placeholder="https://…" />
        </div>
        <div>
          <label class="field-label" for="edit-trailer">Gameplay-Trailer</label>
          <input type="url" id="edit-trailer" maxlength="500" value="${escapeHtml(game.trailer_url ?? '')}" placeholder="https://…" />
        </div>
        <div class="row" style="align-items:flex-start;">
          <div style="flex:1;">
            <label for="edit-min" class="field-label">Min. Teamgröße</label>
            <input type="number" id="edit-min" min="1" max="20" value="${game.min_team_size}" />
          </div>
          <div style="flex:1;">
            <label for="edit-max" class="field-label">Max. Teamgröße</label>
            <input type="number" id="edit-max" min="1" max="20" value="${game.max_team_size}" />
          </div>
        </div>

        <div class="section-title">Prozessname</div>
        <div class="chip-list">${processChips || '<span class="muted">Noch keine.</span>'}</div>
        ${
          suggestedProcessNames.length
            ? `<button type="button" class="btn btn-sm" id="use-suggested-process" style="align-self:flex-start;">💡 Vorschlag übernehmen: ${escapeHtml(suggestedProcessNames.join(', '))}</button>`
            : ''
        }
        <div class="row" style="align-items:stretch;">
          <input type="text" id="new-process" placeholder="z.B. cs2.exe" style="flex:1;" />
          <button type="button" class="btn" id="add-process">+</button>
        </div>

        <button type="button" class="btn btn-primary btn-block" id="edit-save">Speichern</button>
        ${
          game.isSuggestion
            ? `<button type="button" class="btn btn-primary btn-block" id="edit-promote">In Katalog übernehmen</button>`
            : ''
        }
        <button type="button" class="btn btn-danger btn-block" id="edit-delete">Spiel löschen</button>
      </div>
    `,
    {
      onMount: (el) => {
        el.querySelector('#edit-save').addEventListener('click', async () => {
          const name = el.querySelector('#edit-name').value.trim();
          const minTeamSize = parseInt(el.querySelector('#edit-min').value, 10);
          const maxTeamSize = parseInt(el.querySelector('#edit-max').value, 10);
          const platform = el.querySelector('#edit-platform').value.trim();
          const platformUrl = el.querySelector('#edit-platform-url').value.trim();
          const trailerUrl = el.querySelector('#edit-trailer').value.trim();
          try {
            await api.games.update(gameId, {
              name,
              minTeamSize,
              maxTeamSize,
              platform: platform || null,
              platformUrl: platformUrl || null,
              trailerUrl: trailerUrl || null,
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
            await ctx.refresh();
            activeTab = 'catalog';
            ctx.rerender();
            showToast('Spiel in den Katalog übernommen.');
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
          if (!(await confirmDialog(`${game.name} wirklich löschen? Skill-/Bock-Wertungen und Ergebnisse dazu gehen verloren.`))) return;
          try {
            await api.games.remove(gameId);
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
  ensureDragGuardInstalled();
  if (sliderDragActive) return;

  if (suggestionsCache === null && !suggestionsLoading) loadSuggestions(ctx);

  const myId = getMyId();
  const games = state.games.filter((g) => (activeTab === 'suggestions' ? g.isSuggestion : !g.isSuggestion));
  const rows = sortedGames(games, myId);

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">‹ Zurück</button>
    <h1 class="view-title">🎮 Spiele</h1>
    ${whoAmICardHtml('whoami')}
    <div class="row-between" style="margin-top:var(--space-3);gap:var(--space-3);align-items:center;">
      <div class="tabs" style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
        <button type="button" class="btn btn-sm ${activeTab === 'catalog' ? 'btn-primary' : ''}" data-tab="catalog">Alle</button>
        <button type="button" class="btn btn-sm ${activeTab === 'suggestions' ? 'btn-primary' : ''}" data-tab="suggestions">Vorschläge</button>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="suggest-new">+ Spiel vorschlagen</button>
    </div>
    <div class="row" style="gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-3);">
      ${sortButton('name', 'Name')}
      ${sortButton('myBock', 'Mein Bock')}
      ${sortButton('avgBock', 'Ø Bock')}
      ${activeTab === 'catalog' ? sortButton('avgSkill', 'Ø Skill') : ''}
    </div>
    <div class="game-table" style="margin-top:var(--space-3);">
      ${
        rows.length === 0
          ? `<div class="empty-state"><span class="emoji">🎮</span>${activeTab === 'suggestions' ? 'Noch keine vorgeschlagenen Spiele.' : 'Noch keine Spiele im Katalog.'}</div>`
          : rows.map((g) => gameRowHtml(g, myId)).join('')
      }
    </div>
  `;

  wireWhoAmICard(container, 'whoami', ctx);

  container.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (sortKey === btn.dataset.sort) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = btn.dataset.sort;
        sortDir = sortKey === 'name' ? 'asc' : 'desc';
      }
      ctx.rerender();
    });
  });

  container.querySelector('#suggest-new').addEventListener('click', () => openSuggestForm(ctx));

  container.querySelectorAll('[data-detail]').forEach((btn) => {
    btn.addEventListener('click', () => openGameDetail(btn.dataset.detail, ctx));
  });

  container.querySelectorAll('.skill-row').forEach((row) => {
    const gameId = row.dataset.game;
    const kind = row.dataset.kind;
    const slider = row.querySelector('input[type="range"]');
    const valueEl = row.querySelector('.skill-value');
    const updateSliderTone = () => {
      slider.style.setProperty('--slider-pct', `${((Number(slider.value) - 1) / 9) * 100}%`);
    };
    updateSliderTone();
    slider.addEventListener('pointerdown', () => {
      sliderDragActive = true;
    });
    let debounceTimer = null;
    slider.addEventListener('input', () => {
      valueEl.textContent = slider.value;
      updateSliderTone();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          if (kind === 'bock') {
            // No ctx.refresh(): the 'preferences:changed' broadcast this
            // triggers (see app.js) already patches state for every
            // connected client, including this one.
            await api.preferences.set(myId, gameId, parseInt(slider.value, 10));
          } else {
            await api.skills.set(myId, gameId, parseInt(slider.value, 10));
            await ctx.refresh();
          }
        } catch (err) {
          showToast(err.message, { error: true });
        }
      }, 250);
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
}
