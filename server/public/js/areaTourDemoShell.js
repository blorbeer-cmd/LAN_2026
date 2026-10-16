import { icon } from './icons.js';
import { domainIcon } from './domainIcons.js';
import { escapeHtml } from './format.js';
import { bottomNavItemsForEvent, desktopNavItemsForEvent } from './bottomNav.js';
import { eventSelectOptions } from './eventStatus.js';
import { searchSelectHtml, wireSearchSelect } from './searchSelect.js';

export async function mountTourDemoShell(demo) {
  const event = demo.state.activeEvent;
  const context = document.getElementById('event-context');
  context.hidden = false;
  context.innerHTML = searchSelectHtml('demo-event', eventSelectOptions(demo.state.availableEvents), event.id,
    { placeholder: 'Event suchen', ariaLabel: 'Event oder Gruppe auswählen' });
  wireSearchSelect(context, 'demo-event', eventSelectOptions(demo.state.availableEvents), { onChange: () => {} });
  for (const [id, name] of [['info-btn', 'info'], ['global-search-btn', 'search'], ['notifications-btn', 'bell'], ['feedback-btn', 'messageSquare']]) {
    document.getElementById(id).insertAdjacentHTML('afterbegin', icon(name));
  }
  const bottom = document.querySelector('.bottom-nav-inner');
  bottom.innerHTML = bottomNavItemsForEvent(event).map((entry) => `<button type="button" class="nav-btn${entry.view === demo.view ? ' active' : ''}" data-view="${entry.view}" aria-label="${escapeHtml(entry.ariaLabel)}">
    <span class="nav-icon">${icon(domainIcon(entry.iconKey))}</span><span class="nav-label">${escapeHtml(entry.label)}</span></button>`).join('');
  const rail = desktopNavItemsForEvent(event, { isAdmin: Boolean(demo.me.is_admin) });
  const entryHtml = (entry) => `<button type="button" class="desktop-nav-btn${entry.view === demo.view ? ' active' : ''}" data-view="${entry.view ?? ''}"><span class="desktop-nav-icon">${icon(domainIcon(entry.iconKey))}</span><span class="desktop-nav-label">${escapeHtml(entry.label)}</span></button>`;
  document.getElementById('desktop-nav-main').innerHTML = rail.groups.map((group) => `<div class="desktop-nav-group">${group.label ? `<span class="desktop-nav-heading">${escapeHtml(group.label)}</span>` : ''}${group.entries.map(entryHtml).join('')}</div>`).join('');
  document.getElementById('desktop-nav-utilities').innerHTML = rail.utilities.map(entryHtml).join('');
  if (demo.view === 'home') {
    const [search, info, notifications] = await Promise.all([
      import('./searchPalette.js'), import('./views/infoBoard.js'), import('./notificationBanner.js'),
    ]);
    search.initGlobalSearch(() => {});
    document.getElementById('info-btn').addEventListener('click', () => info.openInfoBoard());
    notifications.initNotificationBanner();
  }
}

// Native Arcade view subscriptions receive fixtures instead of a transport.
// No Socket.IO script, connection, command or acknowledgement reaches a server.
export function installTourSocket(snapshots = {}) {
  window.io = () => {
    const listeners = new Map();
    const socket = { connected: true, id: 'tour-socket',
      on(name, callback) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
        if (Object.hasOwn(snapshots, name)) queueMicrotask(() => callback(structuredClone(snapshots[name])));
        return socket;
      },
      once(name, callback) { return socket.on(name, callback); },
      off(name, callback) { listeners.get(name)?.delete(callback); return socket; },
      emit(_name, ...args) { const ack = args.at(-1); if (typeof ack === 'function') ack({ ok: false, error: 'Nur zur Ansicht.' }); return socket; },
      disconnect() { listeners.clear(); socket.connected = false; return socket; },
    };
    return socket;
  };
}
