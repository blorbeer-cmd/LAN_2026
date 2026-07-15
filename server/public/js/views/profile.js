// "Mein Profil" view: each invited player picks/creates their own identity
// (reusing the whoami.js mechanism already used by the Live view for pausing
// and by Votes for casting a vote — this tool has no real per-person login,
// just a shared access token, so "who am I" is a convenience the browser
// remembers locally, not a security boundary), then can maintain their own
// gamer name (unique across everyone), a profile picture and seat neighbors.
// Bock/Skill-Ratings moved to the Spiele view (see server/CLAUDE.md games
// reorg) — that's where the group averages live too, so this page just
// points there instead of duplicating the sliders. Personal playtime/awards
// stats live on their own view (myStats.js) — kept separate so this setup
// page doesn't turn into an ever-longer scroll mixing one-time setup with an
// open-ended dashboard.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { getMyId, setMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { getPushSubscriptionState, enablePush, disablePush } from '../push.js';
import { invalidateMyStats } from './myStats.js';
import { resizeImageFile } from '../imageUtils.js';
import { icon } from '../icons.js';

// Whose monitor you've declared you can see ("Sichtbare Monitore") for the
// active event (FR-18 extension) — pre-filled from same-edge seat placements
// in the seating plan, plus anything checked here manually. Fetched lazily,
// reset whenever the active identity changes.
let neighborsCache = null;
let neighborsLoading = false;
let neighborsForPlayerId = null;

// 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | null (not yet
// checked). Re-checked whenever the view renders fresh (cheap local
// permission/registration lookups, no network round trip).
let pushState = null;
let pushBusy = false;

function renderIdentityPicker(container, ctx) {
  const myId = getMyId();
  container.innerHTML = `
    <h1 class="view-title">Willkommen bei Respawn</h1>
    <div class="card stack">
      <div class="player-name">Neu hier? Leg dir dein Profil an:</div>
      <form id="profile-new-form" class="row">
        <input type="text" id="profile-new-name" placeholder="Dein Gamer-Name" maxlength="60" style="flex:1;" required autofocus />
        <button type="submit" class="btn btn-primary btn-sm">Los geht's</button>
      </form>
      <div class="muted" style="font-size:var(--font-size-xs);">Profilbild, Skills und dein Agent-Key richtest du direkt im Anschluss ein.</div>
    </div>

    <div class="section-title">Schon dabei?</div>
    <div class="card">
      <select id="profile-whoami">
        <option value="">– deinen Namen wählen –</option>
        ${state.players.map((p) => `<option value="${p.id}" ${p.id === myId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
    </div>
  `;

  container.querySelector('#profile-whoami').addEventListener('change', (e) => {
    if (!e.target.value) return;
    setMyId(e.target.value);
    ctx.rerender();
  });

  container.querySelector('#profile-new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = container.querySelector('#profile-new-name').value.trim();
    if (!name) return;
    try {
      const created = await api.players.create({ name });
      await ctx.refresh();
      setMyId(created.id);
      showToast(`Willkommen, ${created.name}!`);
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}

// The seating plan editor (seating.js) may have just auto-filled/updated our
// own visible-monitor pairs — refetch next render instead of showing a stale
// cache (same pattern as live.js's seatingCache invalidation).
window.addEventListener('seating:changed', () => {
  neighborsForPlayerId = null;
});

async function loadNeighbors(playerId, ctx) {
  neighborsLoading = true;
  try {
    neighborsCache = await api.players.neighbors(playerId);
    neighborsForPlayerId = playerId;
  } catch (err) {
    showToast(err.message, { error: true });
    neighborsCache = null;
  } finally {
    neighborsLoading = false;
    ctx.rerender();
  }
}

function renderNeighbors(myId) {
  const others = state.players.filter((p) => p.id !== myId);
  if (others.length === 0) {
    return `<div class="empty-state" style="padding:var(--space-4);">Noch keine anderen Spieler da.</div>`;
  }
  if (neighborsLoading || neighborsCache === null) {
    return `<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  const checked = new Set(neighborsCache.neighborIds);
  return others
    .map(
      (p) => `
      <label class="check-row">
        <input type="checkbox" data-neighbor="${p.id}" ${checked.has(p.id) ? 'checked' : ''} />
        ${avatarHtml(p, 20)}
        <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>
      </label>`
    )
    .join('');
}

async function loadPushState(ctx) {
  pushState = await getPushSubscriptionState();
  ctx.rerender();
}

function renderPushSection() {
  if (pushState === 'unsupported') {
    return `<div class="muted" style="font-size:var(--font-size-sm);">Dieser Browser unterstützt keine Push-Benachrichtigungen.</div>`;
  }
  if (pushState === 'denied') {
    return `<div class="muted" style="font-size:var(--font-size-sm);">Berechtigung wurde blockiert – in den Browser-Einstellungen für diese Seite wieder erlauben.</div>`;
  }
  const subscribed = pushState === 'subscribed';
  return `
    <div class="row-between">
      <span class="muted" style="font-size:var(--font-size-sm);">${subscribed ? 'Aktiv auf diesem Gerät.' : 'Erhalte einen Hinweis auch, wenn die App nicht offen ist.'}</span>
      <button type="button" class="btn btn-sm ${subscribed ? 'btn-danger' : 'btn-primary'}" id="push-toggle" ${pushBusy ? 'disabled' : ''}>
        ${pushBusy ? 'Einen Moment…' : subscribed ? 'Deaktivieren' : 'Aktivieren'}
      </button>
    </div>`;
}

export function renderProfile(container, ctx) {
  const myId = getMyId();
  const me = state.players.find((p) => p.id === myId);
  if (!me) {
    renderIdentityPicker(container, ctx);
    return;
  }

  if (neighborsForPlayerId !== myId && !neighborsLoading) {
    loadNeighbors(myId, ctx);
  }
  if (pushState === null) {
    loadPushState(ctx);
  }

  // A brand-new player has rated nothing yet — nudge them to the Spiele
  // view once, prominently. Once at least one rating exists, a plain link
  // further down (next to "Meine Statistiken") is enough.
  const hasAnyRating =
    state.skills.some((s) => s.player_id === myId) || state.preferences.some((p) => p.player_id === myId);

  container.innerHTML = `
    <div class="row-between">
      <h1 class="view-title">Mein Profil</h1>
      <button type="button" class="btn btn-sm" id="profile-not-me">Nicht du?</button>
    </div>

    <div class="card stack">
      <div class="row" style="align-items:center;">
        <label for="profile-avatar-input" style="cursor:pointer;">
          ${avatarHtml(me, 64)}
        </label>
        <input type="file" id="profile-avatar-input" accept="image/*" hidden />
        <div class="stack" style="flex:1;gap:var(--space-2);">
          <input type="color" id="profile-color" value="${me.color}" aria-label="Profilfarbe" />
          <div class="field-row">
            <div>
              <label for="profile-name" class="field-label">Gamer-Name</label>
              <input type="text" id="profile-name" value="${escapeHtml(me.name)}" maxlength="60" />
            </div>
            <div>
              <label for="profile-real-name" class="field-label">Richtiger Name</label>
              <input type="text" id="profile-real-name" value="${escapeHtml(me.real_name || '')}" maxlength="60" placeholder="Optional" />
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="profile-save">Speichern</button>
        </div>
      </div>
    </div>

    ${
      state.games.length === 0
        ? ''
        : hasAnyRating
          ? ''
          : `<div class="card stack" style="border-color:rgba(91,140,255,0.55);">
               <div class="row" style="gap:var(--space-2);align-items:center;">
                 <span class="inline-icon">${icon('gamepad')}</span>
                 <strong>Bock & Skill eintragen</strong>
               </div>
               <p class="muted" style="font-size:var(--font-size-xs);margin:0;">
                 Worauf hast du Lust, was kannst du gut? Trag das kurz in der Spiele-Liste ein – dauert
                 eine Minute und hilft beim Voting und beim Teams-Auslosen.
               </p>
               <button type="button" class="btn btn-primary btn-block" data-navigate="gameCatalog">Zu den Spielen</button>
             </div>`
    }

    <div class="section-title">${icon('monitor')} Live-Status-Agent</div>
    <div class="card stack">
      <label class="check-row">
        <input type="checkbox" id="tracking-paused" ${me.tracking_paused ? 'checked' : ''} />
        <span style="flex:1;">Tracking pausieren</span>
      </label>
      <p class="muted" style="font-size:var(--font-size-xs);margin-top:calc(var(--space-1) * -1);">
        Dein Agent darf weiterlaufen und meldet sich weiter beim Server, aber nichts davon wird
        gespeichert – kein Live-Status, keine Spielzeit. Dasselbe Pausieren geht auch direkt am PC
        über die Steuerungs-Oberfläche des Agents – beide Wege zeigen denselben Stand.
      </p>
      <label class="check-row">
        <input type="checkbox" id="agent-track-activity" />
        <span style="flex:1;">Erweitertes Aktivitäts-Tracking</span>
      </label>
      <p class="muted" style="font-size:var(--font-size-xs);margin-top:calc(var(--space-1) * -1);">
        Aus (Standard): der Server weiß nur „läuft Spiel X gerade". An: zusätzlich, ob das
        Spielfenster wirklich im Vordergrund ist statt nur im Hintergrund zu laufen – zeigt sich z. B.
        als „davon aktiv gespielt" in deiner Statistik. Das hier ist nur der Startwert für den
        nächsten Download – danach lässt sich das jederzeit in der Steuerungs-Oberfläche des Agents
        (Desktop-Verknüpfung „Respawn-Agent Steuerung") umschalten, ohne neu herunterzuladen.
      </p>
      <button type="button" class="btn btn-primary btn-block" id="agent-download">${icon('download')} Agent für Windows herunterladen</button>
      <p class="muted" style="font-size:var(--font-size-xs);">
        ZIP entpacken, <code>install.bat</code> doppelklicken – Server-Adresse und dein API-Key sind
        schon eingetragen. Der Agent startet danach automatisch bei jedem Windows-Login und erkennt,
        welches Spiel du gerade spielst. Im selben ZIP liegt auch <code>uninstall.bat</code>, falls du
        den Agent später komplett wieder loswerden willst (für ein vorübergehendes Pausieren reicht
        die Option oben).
      </p>
      <details>
        <summary class="muted" style="font-size:var(--font-size-xs);cursor:pointer;">Kein Windows / manuelle Einrichtung</summary>
        <div class="row" style="margin-top:var(--space-2);">
          <input type="text" id="profile-apikey" readonly value="Laden…" style="flex:1;font-family:monospace;" />
          <button type="button" class="btn btn-sm" id="profile-copy-key">Kopieren</button>
        </div>
        <p class="muted" style="font-size:var(--font-size-xs);margin-top:var(--space-2);">
          Diesen Key in die Config des Agenten (<code>agent/</code>-Ordner im Repo, mit Node.js
          gestartet) eintragen – siehe <code>agent/README.md</code>.
        </p>
      </details>
    </div>

    <div class="section-title">Push-Benachrichtigungen</div>
    <div class="card">${renderPushSection()}</div>

    <div class="section-title">Sichtbare Monitore</div>
    <div class="card">${renderNeighbors(myId)}</div>
    <div class="card row-between profile-stats-link">
      <strong>Meine Statistiken</strong>
      <button type="button" class="btn btn-sm" data-navigate="myStats">Ansehen</button>
    </div>
  `;

  container.querySelector('#profile-not-me').addEventListener('click', () => {
    setMyId('');
    invalidateMyStats();
    neighborsForPlayerId = null;
    ctx.rerender();
  });

  // Fetched lazily (the roster list intentionally omits API keys) and only
  // ever for your own profile — see the players.js detail modal for the
  // admin-side equivalent.
  api.players
    .get(myId)
    .then((full) => {
      const input = container.querySelector('#profile-apikey');
      if (input) input.value = full.api_key;
    })
    .catch(() => {
      const input = container.querySelector('#profile-apikey');
      if (input) input.value = 'Fehler beim Laden';
    });

  container.querySelector('#tracking-paused').addEventListener('change', async (e) => {
    try {
      await api.players.update(myId, { trackingPaused: e.target.checked });
      await ctx.refresh();
      showToast(e.target.checked ? 'Tracking pausiert.' : 'Tracking wieder aktiv.');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#profile-copy-key').addEventListener('click', async () => {
    const value = container.querySelector('#profile-apikey').value;
    try {
      await navigator.clipboard.writeText(value);
      showToast('API-Key kopiert.');
    } catch {
      showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
    }
  });

  container.querySelector('#agent-download').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Wird vorbereitet…';
    try {
      const trackActivity = container.querySelector('#agent-track-activity').checked;
      const { blob, filename } = await api.agent.download(myId, trackActivity);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message, { error: true });
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  container.querySelector('#profile-save').addEventListener('click', async () => {
    const name = container.querySelector('#profile-name').value.trim();
    const realName = container.querySelector('#profile-real-name').value.trim();
    const color = container.querySelector('#profile-color').value;
    if (!name) return showToast('Name darf nicht leer sein.', { error: true });
    try {
      await api.players.update(myId, { name, realName: realName || null, color });
      await ctx.refresh();
      showToast('Gespeichert.');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#profile-avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const avatar = await resizeImageFile(file);
      await api.players.update(myId, { avatar });
      await ctx.refresh();
      showToast('Profilbild aktualisiert.');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelectorAll('[data-neighbor]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const ids = [...container.querySelectorAll('[data-neighbor]:checked')].map((el) => el.dataset.neighbor);
      try {
        neighborsCache = await api.players.setNeighbors(myId, ids);
      } catch (err) {
        showToast(err.message, { error: true });
        cb.checked = !cb.checked; // revert the click that failed to save
      }
    });
  });

  const pushToggle = container.querySelector('#push-toggle');
  if (pushToggle) {
    pushToggle.addEventListener('click', async () => {
      pushBusy = true;
      ctx.rerender();
      try {
        if (pushState === 'subscribed') {
          await disablePush();
          showToast('Push-Benachrichtigungen deaktiviert.');
        } else {
          await enablePush(myId);
          showToast('Push-Benachrichtigungen aktiviert.');
        }
      } catch (err) {
        showToast(err.message, { error: true });
      } finally {
        pushBusy = false;
        pushState = await getPushSubscriptionState();
        ctx.rerender();
      }
    });
  }
}
