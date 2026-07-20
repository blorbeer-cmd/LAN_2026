import { api } from './api.js';
import { escapeHtml } from './format.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { feedEntryTitle, feedLinkView } from './pushFeed.js';
import { state } from './state.js';
import { getMyId } from './whoami.js';
import { isAdmin } from './admin.js';

export const SEARCH_ENTRIES = [
  { view: 'home', title: 'Home', category: 'Bereich', description: 'Aktuelles, Live-Status und Überblick', aliases: 'start übersicht dashboard', priority: 100 },
  { view: 'tournaments', title: 'Turniere', category: 'Bereich', description: 'Turniere anlegen und Ergebnisse verwalten', aliases: 'tournament ko runde bracket', priority: 99 },
  { view: 'matchmaking', title: 'Teams', category: 'Bereich', description: 'Auslosen, Captain Draft und Historie', aliases: 'teams auslosen matchmaking captain draft kraft team-historie ergebnis-historie', priority: 98 },
  { view: 'votes', title: 'Vote', category: 'Bereich', description: 'Gemeinsam das nächste Spiel wählen', aliases: 'abstimmung voting punkte spielwahl', priority: 97 },
  { view: 'leaderboard', title: 'Rangliste', category: 'Bereich', description: 'Ergebnisse, Punkte und Platzierungen', aliases: 'rang leaderboard ergebnis match', priority: 96 },
  { view: 'more', title: 'Mehr', category: 'Bereich', description: 'Alle weiteren Bereiche und Tools', aliases: 'menü tools', priority: 95 },
  { view: 'profile', title: 'Mein Profil', category: 'Bereich', description: 'Profil, Agent und Push-Benachrichtigungen', aliases: 'account ich agent benachrichtigung', priority: 90 },
  { view: 'myStats', title: 'Meine Statistiken', category: 'Bereich', description: 'Eigene Spielzeit und persönliche Werte', aliases: 'stats spielzeit auswertung', priority: 80 },
  { view: 'settings', title: 'Einstellungen', category: 'Bereich', description: 'Events, Einladungslink und Kiosk verwalten', aliases: 'setup konfiguration event einladung kiosk', priority: 85 },
  { view: 'admin', title: 'Admin', category: 'Bereich', description: 'Sitzplan, Backup, Test-Spieler, Rechte und Diagnose', aliases: 'moderation verwaltung diagnose sitzplan backup', priority: 60 },
  { view: 'players', title: 'Spieler', category: 'Bereich', description: 'Spielerprofile und Bewertungen ansehen', aliases: 'teilnehmer roster personen profil', priority: 70 },
  { view: 'gameCatalog', title: 'Spiele', category: 'Bereich', description: 'Bock, Skill und Spielekatalog', aliases: 'games katalog bewertung skill bock', priority: 75 },
  { view: 'arrivals', title: 'An- & Abreise', category: 'Bereich', description: 'Zeiten und Fahrgemeinschaften planen', aliases: 'anreise abreise ankunft abfahrt fahrt carpool', priority: 65 },
  { view: 'arcade', title: 'Arcade', category: 'Bereich', description: 'Minigame-Lobbies öffnen und mitspielen', aliases: 'quiz tetris scribble pong blobby snake minigame', priority: 74 },
  { view: 'analytics', title: 'Auswertungen', category: 'Bereich', description: 'Awards und gemeinsame Statistiken', aliases: 'analytics statistik awards spielzeit', priority: 64 },
  { view: 'broadcast', title: 'Durchsage', category: 'Bereich', description: 'Eine Mitteilung an alle Geräte senden', aliases: 'ansage nachricht push kiosk', priority: 63 },
  { view: 'music', title: 'Jam', category: 'Bereich', description: 'Gemeinsame Spotify-Warteschlange', aliases: 'spotify musik songs queue warteschlange', priority: 64 },
  { view: 'foodOrders', title: 'Essen', category: 'Bereich', description: 'Sammelbestellungen koordinieren', aliases: 'bestellung food pizza lieferdienst', priority: 68 },
  { view: 'hallOfFame', title: 'Hall of Fame', category: 'Bereich', description: 'Champions vergangener Events', aliases: 'champions sieger historie ruhmeshalle', priority: 61 },
  { view: 'infoBoard', title: 'Info', category: 'Bereich', description: 'WLAN, Discord, Server und Hausregeln', aliases: 'info board information wlan discord server hausregeln', priority: 69 },
  { view: 'checklist', title: 'Packliste', category: 'Bereich', description: 'Persönliche Packliste, Aufgaben und Mitbring-Anfragen', aliases: 'packen todo aufgabe anfrage mitbringen checkliste', priority: 66 },
  { view: 'seating', title: 'Sitzplan', category: 'Bereich', description: 'Plätze und sichtbare Monitore verwalten', aliases: 'sitzplatz tisch monitore nachbarn', priority: 67, adminOnly: true },
];

export function normalizeSearchText(value) {
  return String(value ?? '')
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function searchEntries(query, entries = SEARCH_ENTRIES, limit = 20) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(/\s+/);
  return entries
    .map((entry) => {
      const title = normalizeSearchText(entry.title);
      const haystack = normalizeSearchText(`${entry.title} ${entry.category} ${entry.description} ${entry.aliases ?? ''}`);
      if (!terms.every((term) => haystack.includes(term))) return null;

      let score = entry.priority ?? 0;
      if (title === normalizedQuery) score += 1000;
      else if (title.startsWith(normalizedQuery)) score += 700;
      else if (title.split(' ').some((word) => word.startsWith(normalizedQuery))) score += 500;
      score += terms.filter((term) => title.includes(term)).length * 100;
      return { ...entry, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'de'))
    .slice(0, limit);
}

function compactText(value, maxLength = 100) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function createContentSearchEntries(appState, content = {}) {
  const playerEntries = (appState.players ?? []).map((player) => ({
    view: 'players',
    title: player.name,
    category: 'Spieler',
    description: player.real_name ? `${player.real_name} · Spielerprofil` : 'Spielerprofil öffnen',
    aliases: `${player.real_name ?? ''} ${player.note ?? ''}`,
    priority: 88,
    target: { type: 'player', id: player.id },
  }));
  const gameEntries = (appState.games ?? []).map((game) => ({
    view: 'gameCatalog',
    title: game.name,
    category: 'Spiel',
    description: game.platform ? `${game.platform} · Spiel im Katalog` : 'Spiel im Katalog',
    aliases: `${game.processNames?.join(' ') ?? ''} ${game.genre ?? ''}`,
    priority: 82,
    target: { type: 'game', id: game.id },
  }));
  const eventEntries = (appState.events ?? []).map((event) => ({
    view: 'settings',
    title: event.name,
    category: 'Event',
    description: compactText(event.location || event.description || 'Event verwalten'),
    aliases: `${event.location ?? ''} ${event.description ?? ''}`,
    priority: 70,
  }));
  const orderEntries = (content.orders ?? []).map((order) => ({
    view: 'foodOrders',
    title: order.title,
    category: 'Bestellung',
    description: `${order.open ? 'Offen' : 'Geschlossen'}${order.createdByName ? ` · von ${order.createdByName}` : ''}`,
    aliases: `${order.notes ?? ''} ${(order.items ?? []).map((item) => `${item.playerName ?? ''} ${item.description ?? ''}`).join(' ')}`,
    priority: 92,
    target: { type: 'order', id: order.id },
  }));
  const infoEntries = (content.infoEntries ?? []).map((entry) => ({
    view: 'infoBoard',
    title: feedEntryTitle(entry),
    category: 'Info',
    description: compactText(entry.content),
    aliases: entry.content,
    priority: 84,
    target: { type: 'info', id: entry.id },
  }));
  const broadcastEntries = (content.broadcasts ?? []).map((entry) => ({
    view: 'broadcast',
    title: compactText(entry.message, 80),
    category: 'Durchsage',
    description: entry.playerName ? `von ${entry.playerName}` : 'Mitteilung an alle',
    aliases: `${entry.playerName ?? ''} ${entry.message ?? ''}`,
    priority: 78,
    target: { type: 'broadcast', id: entry.id },
  }));
  const carpools = ['arrival', 'departure'].flatMap((direction) =>
    (content.carpools?.[direction] ?? []).map((carpool) => ({
      view: 'arrivals',
      title: carpool.label,
      category: direction === 'arrival' ? 'Anreise' : 'Abreise',
      description: compactText(carpool.startLocation || `${carpool.seatsFree}/${carpool.seatsTotal} Plätze frei`),
      aliases: `${carpool.createdByName ?? ''} ${carpool.startLocation ?? ''} ${(carpool.members ?? []).map((member) => member.name).join(' ')}`,
      priority: 76,
      target: { type: 'carpool', id: carpool.id },
    }))
  );
  const tournamentEntries = (content.tournaments ?? []).map((tournament) => ({
    view: 'tournaments',
    title: tournament.name,
    category: 'Turnier',
    description: compactText(tournament.gameName || tournament.status || 'Turnier öffnen'),
    aliases: `${tournament.gameName ?? ''} ${tournament.status ?? ''}`,
    priority: 86,
    target: { type: 'tournament', id: tournament.id },
  }));
  const notificationEntries = (content.notifications ?? []).map((entry) => ({
    view: feedLinkView(entry.url) || 'home',
    title: entry.title,
    category: 'Mitteilung',
    description: compactText(entry.body),
    aliases: entry.body,
    priority: 74,
  }));

  return [
    ...playerEntries,
    ...gameEntries,
    ...eventEntries,
    ...orderEntries,
    ...infoEntries,
    ...broadcastEntries,
    ...carpools,
    ...tournamentEntries,
    ...notificationEntries,
  ];
}

async function loadContentSearchEntries() {
  const myId = getMyId();
  const requests = [
    api.foodOrders.list(),
    api.info.list(),
    api.broadcasts.list(),
    api.arrivals.list(),
    api.tournaments.list(),
    myId ? api.push.log(myId) : Promise.resolve({ entries: [] }),
  ];
  const [orders, info, broadcasts, arrivals, tournaments, notifications] = await Promise.allSettled(requests);
  const value = (result, fallback) => (result.status === 'fulfilled' ? result.value : fallback);

  return createContentSearchEntries(state, {
    orders: value(orders, { orders: [] }).orders ?? [],
    infoEntries: value(info, { entries: [] }).entries ?? [],
    broadcasts: value(broadcasts, { broadcasts: [] }).broadcasts ?? [],
    carpools: value(arrivals, { carpools: {} }).carpools ?? {},
    tournaments: value(tournaments, []),
    notifications: value(notifications, { entries: [] }).entries ?? [],
  });
}

function isEditableTarget(target) {
  return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');
}

export function initGlobalSearch(onNavigate) {
  const trigger = document.getElementById('global-search-btn');
  if (!trigger) return;
  trigger.innerHTML = icon('search');

  let activeDialog = null;

  const openSearch = () => {
    if (activeDialog?.isConnected) {
      activeDialog.querySelector('#global-search-input')?.focus();
      return;
    }

    openModal(
      'Suchen',
      `<div class="global-search">
        <label class="global-search-label" for="global-search-input">Bereiche und Inhalte durchsuchen</label>
        <input id="global-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Spieler, Bestellung, Spiel, WLAN …" aria-controls="global-search-results" />
        <div id="global-search-summary" class="global-search-summary" aria-live="polite"></div>
        <div id="global-search-results" class="global-search-results" role="listbox" aria-label="Suchergebnisse"></div>
      </div>`,
      {
        onClose: () => {
          activeDialog = null;
        },
        onMount: (backdrop, close) => {
          activeDialog = backdrop;
          backdrop.classList.add('global-search-modal');
          const input = backdrop.querySelector('#global-search-input');
          const summary = backdrop.querySelector('#global-search-summary');
          const resultsContainer = backdrop.querySelector('#global-search-results');
          const visibleAreaEntries = SEARCH_ENTRIES.filter((entry) => !entry.adminOnly || isAdmin());
          let allEntries = [...visibleAreaEntries, ...createContentSearchEntries(state)];
          let results = [];
          let selectedIndex = 0;

          const updateSelection = () => {
            const buttons = [...resultsContainer.querySelectorAll('[data-search-index]')];
            buttons.forEach((button, index) => {
              const selected = index === selectedIndex;
              button.classList.toggle('is-selected', selected);
              button.setAttribute('aria-selected', String(selected));
            });
            const selected = buttons[selectedIndex];
            if (selected) input.setAttribute('aria-activedescendant', selected.id);
            else input.removeAttribute('aria-activedescendant');
            selected?.scrollIntoView({ block: 'nearest' });
          };

          const renderResults = () => {
            const hasQuery = normalizeSearchText(input.value).length > 0;
            results = searchEntries(input.value, allEntries);
            selectedIndex = 0;
            summary.textContent = hasQuery ? `${results.length} Treffer` : '';
            if (!hasQuery) {
              resultsContainer.innerHTML = '';
              input.removeAttribute('aria-activedescendant');
              return;
            }
            if (results.length === 0) {
              resultsContainer.innerHTML = '<div class="global-search-empty">Kein passender Inhalt gefunden.</div>';
              input.removeAttribute('aria-activedescendant');
              return;
            }
            resultsContainer.innerHTML = results
              .map(
                (entry, index) => `<button type="button" id="global-search-result-${index}" class="global-search-result" role="option" aria-selected="false" data-search-index="${index}">
                  <span class="global-search-result-main"><strong>${escapeHtml(entry.title)}</strong><span class="muted">${escapeHtml(entry.category)}</span></span>
                  <span class="muted global-search-result-description">${escapeHtml(entry.description)}</span>
                </button>`
              )
              .join('');
            updateSelection();
          };

          const activateSelected = () => {
            const entry = results[selectedIndex];
            if (!entry) return;
            close();
            onNavigate(entry);
          };

          input.addEventListener('input', renderResults);
          input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' && results.length) {
              event.preventDefault();
              selectedIndex = (selectedIndex + 1) % results.length;
              updateSelection();
            } else if (event.key === 'ArrowUp' && results.length) {
              event.preventDefault();
              selectedIndex = (selectedIndex - 1 + results.length) % results.length;
              updateSelection();
            } else if (event.key === 'Enter') {
              event.preventDefault();
              activateSelected();
            }
          });
          // pointermove instead of pointerover: when a keyboard selection
          // re-renders or scrolls the list, Chromium re-dispatches a
          // synthetic pointerover for whatever now sits under a stationary
          // cursor — which silently snapped the highlight back to the hovered
          // row. Only genuine pointer movement may take over the selection.
          resultsContainer.addEventListener('pointermove', (event) => {
            const button = event.target.closest('[data-search-index]');
            if (!button) return;
            const index = Number(button.dataset.searchIndex);
            if (index === selectedIndex) return;
            selectedIndex = index;
            updateSelection();
          });
          resultsContainer.addEventListener('click', (event) => {
            const button = event.target.closest('[data-search-index]');
            if (!button) return;
            selectedIndex = Number(button.dataset.searchIndex);
            activateSelected();
          });

          renderResults();
          input.focus();
          loadContentSearchEntries().then((contentEntries) => {
            if (!backdrop.isConnected) return;
            // Merging the late content entries re-renders the result list; a
            // keyboard selection made in the meantime must survive instead of
            // silently snapping back to the first result while the user is
            // about to press Enter.
            const previousSelection = results[selectedIndex];
            allEntries = [...visibleAreaEntries, ...contentEntries];
            renderResults();
            if (previousSelection) {
              const restored = results.findIndex(
                (entry) =>
                  entry.view === previousSelection.view &&
                  entry.title === previousSelection.title &&
                  entry.category === previousSelection.category
              );
              if (restored > 0) {
                selectedIndex = restored;
                updateSelection();
              }
            }
          });
        },
      }
    );
  };

  trigger.addEventListener('click', openSearch);
  document.addEventListener('keydown', (event) => {
    const shortcut = (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase('de-DE') === 'k';
    const slash = event.key === '/' && !isEditableTarget(event.target);
    if (!shortcut && !slash) return;
    event.preventDefault();
    openSearch();
  });
}
