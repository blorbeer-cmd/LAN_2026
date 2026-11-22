// OAuth consent and scoped connection management share the normal Respawn
// session. Only this browser flow can approve a destructive cleanup plan.
import { apiFetch } from './api.js';
import { escapeHtml, formatDateTime } from './format.js';
import { confirmDialog } from './modal.js';
import { withStepUp } from './reauth.js';

const content = document.querySelector('#mcp-content');
const status = document.querySelector('#mcp-status');
const query = new URLSearchParams(location.search);
const requestId = query.get('request');
const planId = query.get('plan');
const title = requestId ? 'Respawn mit ChatGPT verbinden' : planId ? 'Auslosungen aufräumen' : 'ChatGPT-Verbindungen';
document.title = `${title} – Respawn`;
document.querySelector('.view-title').textContent = title;
let account;

function message(text) { status.textContent = text; }
async function busy(button, action) {
  button.disabled = true;
  try { await action(); } catch (error) { message(error.message); }
  finally { if (button.isConnected) button.disabled = false; }
}
const post = (url, body) => apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
const eventOptions = (events = []) => events.map((event) => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.name)}</option>`).join('');
const scopeLabels = (scopes) => scopes.split(' ').map((scope) => ({
  'event:read': 'Eventdaten lesen', 'teams:preview': 'Teams vorschlagen', 'draws:cleanup': 'Admin-Bereinigung vorbereiten',
})[scope] || 'Weitere Freigabe').join(' · ');
const drawLabel = (count) => count === 1 ? 'Auslosung' : 'Auslosungen';
const sourceLabel = (source) => ({ automatic: 'Automatisch ausgelost', draft: 'Captain-Draft', rematch: 'Rematch' })[source] || 'Teamaufstellung';

function login() {
  message('Bitte mit deinem persönlichen Respawn-Konto anmelden.');
  content.innerHTML = `<section class="card stack grouped-page-section">
    <h2>Anmelden</h2><form id="mcp-login" class="stack">
      <label class="field-label is-required" for="mcp-name">Name</label>
      <input id="mcp-name" name="username" autocomplete="username" required />
      <label class="field-label is-required" for="mcp-password">Passwort</label>
      <input id="mcp-password" name="password" type="password" autocomplete="current-password" required />
      <div class="row" style="justify-content:flex-end;"><button class="btn btn-primary" type="submit">Anmelden</button></div>
    </form></section>`;
  content.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    busy(form.querySelector('button'), async () => {
      await post('/api/auth/login', { name: form.elements.username.value, password: form.elements.password.value });
      form.elements.password.value = '';
      await start();
    });
  });
}

async function consent() {
  const pending = await apiFetch(`/mcp/oauth/pending/${encodeURIComponent(requestId)}`);
  message(`Angemeldet als ${account.name}`);
  content.innerHTML = `<section class="card stack grouped-page-section">
    <h2>Respawn mit ChatGPT verbinden</h2>
    <p>ChatGPT darf die freigegebenen Daten des gewählten Events abrufen: Teilnehmer, Spiele, Statistiken,
      Umfragen und veröffentlichte Auswertungen. Abgerufene Daten werden im Chat verarbeitet.</p>
    ${pending.scopes.includes('teams:preview') ? '<p>Unverbindliche Teamvorschläge sind erlaubt.</p>' : ''}
    <form id="mcp-consent" class="stack">
      <label class="field-label is-required" for="mcp-event">Event</label>
      <select id="mcp-event" name="eventId" required>${eventOptions(account.events)}</select>
      ${pending.scopes.includes('draws:cleanup') ? '<label><input type="checkbox" name="allowCleanup" /> Admin-Bereinigung erlauben. Jede Löschung muss zusätzlich in Respawn bestätigt werden.</label>' : ''}
      <p>Die Verbindung gilt 30 Tage und kann hier jederzeit widerrufen werden.</p>
      <div class="row" style="justify-content:flex-end;"><button type="button" class="btn" id="mcp-deny">Ablehnen</button>
        <button class="btn btn-primary" type="submit" ${account.events.length ? '' : 'disabled'}>Verbinden</button></div>
    </form>${account.events.length ? '' : '<p>Keine zugänglichen Events. Nimm zuerst eine Event-Einladung in Respawn an.</p>'}
    </section>`;
  const send = async (deny) => {
    const form = content.querySelector('form');
    const result = await post('/mcp/oauth/consent', { requestId, deny, eventId: form.elements.eventId.value,
      allowCleanup: form.elements.allowCleanup?.checked === true });
    // The server returns only its registered, exact ChatGPT redirect URI.
    location.assign(result.redirect);
  };
  content.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault(); busy(event.currentTarget.querySelector('[type="submit"]'), () => send(false));
  });
  content.querySelector('#mcp-deny').addEventListener('click', (event) => busy(event.currentTarget, () => send(true)));
}

async function showPlan(id) {
  const plan = await apiFetch(`/api/integrations/cleanup/${encodeURIComponent(id)}`);
  let section = document.querySelector('#mcp-plan');
  if (!section) { section = document.createElement('section'); section.id = 'mcp-plan'; content.append(section); }
  section.className = 'card stack grouped-page-section';
  section.innerHTML = `<h2>Bereinigung prüfen</h2>
    <p>${escapeHtml(plan.eventName)} · Älter als ${escapeHtml(formatDateTime(plan.cutoff))}</p>
    <p>${plan.count} ${drawLabel(plan.count)} ohne Ergebnis · Geschützt: ${plan.protectedCount}</p>
    <p>Auslosungen werden dauerhaft entfernt. Verknüpfte Ergebnisse, Turniere und Tipps werden nicht gelöscht.
      Die Zahl vorhandener Auslosungen in der Statistik sinkt entsprechend.</p>
    <details><summary>Betroffene Auslosungen (${plan.count})</summary>
      <ul>${plan.entries.map((entry) => `<li>${escapeHtml(entry.gameName)} · ${escapeHtml(formatDateTime(entry.generatedAt))} · ${escapeHtml(sourceLabel(entry.source))} · ${escapeHtml(entry.id)}</li>`).join('')}</ul>
    </details>
    ${plan.protectedCount ? `<details><summary>Geschützte Einträge (${plan.protectedCount})</summary><ul>${plan.protectedEntries.map((entry) => `<li>${escapeHtml(entry.gameName)} · ${escapeHtml(entry.id)} · ${escapeHtml(entry.protectedReason)}</li>`).join('')}</ul></details>` : ''}
    ${plan.outcome ? `<p role="status">Bereinigung abgeschlossen: ${plan.outcome.deleted} ${drawLabel(plan.outcome.deleted)} gelöscht.</p>` : `
      <p>Vorschau gültig bis ${escapeHtml(formatDateTime(plan.expiresAt))}.</p>
      <div class="row" style="justify-content:flex-end;"><button class="btn btn-danger" id="mcp-cleanup-confirm" ${plan.count && plan.expiresAt > Date.now() ? '' : 'disabled'}>${plan.count} ${drawLabel(plan.count)} löschen</button></div>`}`;
  section.querySelector('#mcp-cleanup-confirm')?.addEventListener('click', (event) => busy(event.currentTarget, async () => {
    if (!(await confirmDialog(`${plan.count} ${drawLabel(plan.count)} ohne Ergebnis in „${plan.eventName}“ dauerhaft löschen?`,
      { title: 'Auslosungen aufräumen', confirmText: 'Dauerhaft löschen', danger: true }))) return;
    const result = await withStepUp(() => post(`/api/integrations/cleanup/${encodeURIComponent(id)}/confirm`, { confirmedCount: plan.count }),
      { title: 'Auslosungen löschen' });
    if (result) { message(`${result.deleted} ${drawLabel(result.deleted)} gelöscht.`); await showPlan(id); }
  }));
  section.scrollIntoView({ block: 'nearest' });
}

function manage() {
  message(`Angemeldet als ${account.name}`);
  content.innerHTML = `<section class="card stack grouped-page-section">
    <h2>ChatGPT-Verbindungen</h2>
    ${account.endpoint ? `<label class="field-label" for="mcp-endpoint">MCP-Server-URL</label>
      <input id="mcp-endpoint" readonly value="${escapeHtml(account.endpoint)}" />
      <p>In ChatGPT unter Plugins einen eigenen MCP-Server mit dieser URL und OAuth hinzufügen.
        Anschließend das Respawn-Plugin im Chat über @ auswählen.</p>` : `<p>${escapeHtml(account.configurationError || 'MCP ist auf diesem Server noch nicht eingerichtet. Die Orga kann den Zugang aktivieren.')}</p>`}
    <div class="stack">${account.connections.length ? account.connections.map((connection) => `
      <div class="profile-row"><div class="profile-row-main"><span class="profile-row-text">
        <span class="profile-row-title">${escapeHtml(connection.eventName)}</span>
        <span class="profile-row-meta">Bis ${escapeHtml(formatDateTime(connection.expiresAt))} · ${escapeHtml(scopeLabels(connection.scopes))}</span>
      </span></div><div class="profile-row-action"><button class="btn btn-sm" data-revoke="${escapeHtml(connection.id)}">Widerrufen</button></div></div>`).join('') : '<p>Keine aktiven Verbindungen.</p>'}</div>
    </section>`;
  content.querySelectorAll('[data-revoke]').forEach((button) => button.addEventListener('click', () => busy(button, async () => {
    if (!(await confirmDialog('Diese ChatGPT-Verbindung widerrufen?', { confirmText: 'Widerrufen' }))) return;
    await apiFetch(`/api/integrations/connections/${encodeURIComponent(button.dataset.revoke)}`, { method: 'DELETE' });
    message('Verbindung widerrufen. Bereits im Chat angezeigte Daten bleiben dort sichtbar.');
    await start();
  })));
}

async function start() {
  try {
    account = await apiFetch('/api/integrations/status');
    if (requestId) await consent();
    else if (planId) {
      message(`Angemeldet als ${account.name}`);
      content.replaceChildren();
      await showPlan(planId);
    } else manage();
  } catch (error) {
    if (error.status === 401) login();
    else {
      message(error.message);
      content.innerHTML = '<section class="card"><button class="btn" id="mcp-retry">Erneut versuchen</button></section>';
      content.querySelector('#mcp-retry').addEventListener('click', start);
    }
  }
}

start();
