import { escapeHtml } from './format.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';

export const SEARCH_ENTRIES = [
  { view: 'home', title: 'Home', category: 'Hauptbereich', description: 'Aktuelles, Live-Status und Überblick', aliases: 'start übersicht dashboard', priority: 100 },
  { view: 'tournaments', title: 'Turniere', category: 'Hauptbereich', description: 'Turniere anlegen und Ergebnisse verwalten', aliases: 'tournament ko runde bracket', priority: 99 },
  { view: 'matchmaking', title: 'Teams auslosen', category: 'Hauptbereich', description: 'Auslosen, Captain Draft und Team-Historie', aliases: 'teams matchmaking captain draft kraft', priority: 98 },
  { view: 'votes', title: 'Abstimmung', category: 'Hauptbereich', description: 'Gemeinsam das nächste Spiel wählen', aliases: 'vote voting punkte spielwahl', priority: 97 },
  { view: 'leaderboard', title: 'Rangliste', category: 'Hauptbereich', description: 'Ergebnisse, Punkte und Platzierungen', aliases: 'rang leaderboard ergebnis match', priority: 96 },
  { view: 'more', title: 'Mehr', category: 'Hauptbereich', description: 'Alle weiteren Bereiche und Tools', aliases: 'menü tools', priority: 95 },
  { view: 'profile', title: 'Mein Profil', category: 'Persönlich', description: 'Profil, Agent und Push-Benachrichtigungen', aliases: 'account ich agent benachrichtigung', priority: 90 },
  { view: 'myStats', title: 'Meine Statistiken', category: 'Persönlich', description: 'Eigene Spielzeit und persönliche Werte', aliases: 'stats spielzeit auswertung', priority: 80 },
  { view: 'settings', title: 'Einstellungen', category: 'Verwaltung', description: 'Events, Spiele und Sicherungen verwalten', aliases: 'setup konfiguration backup event', priority: 85 },
  { view: 'admin', title: 'Admin', category: 'Verwaltung', description: 'Test-Spieler, Rechte und Diagnose', aliases: 'moderation verwaltung diagnose', priority: 60 },
  { view: 'players', title: 'Spieler', category: 'Tool', description: 'Teilnehmende verwalten und Agent-Status prüfen', aliases: 'teilnehmer roster personen agent', priority: 70 },
  { view: 'gameCatalog', title: 'Spiele', category: 'Tool', description: 'Bock, Skill und Spielekatalog', aliases: 'games katalog bewertung skill bock', priority: 75 },
  { view: 'arrivals', title: 'An- & Abreise', category: 'Tool', description: 'Zeiten und Fahrgemeinschaften planen', aliases: 'anreise abreise ankunft abfahrt fahrt carpool', priority: 65 },
  { view: 'arcade', title: 'Arcade', category: 'Tool', description: 'Minigame-Lobbies öffnen und mitspielen', aliases: 'quiz tetris scribble pong blobby snake minigame', priority: 74 },
  { view: 'analytics', title: 'Auswertungen', category: 'Tool', description: 'Awards und gemeinsame Statistiken', aliases: 'analytics statistik awards spielzeit', priority: 64 },
  { view: 'broadcast', title: 'Durchsage', category: 'Tool', description: 'Eine Mitteilung an alle Geräte senden', aliases: 'ansage nachricht push kiosk', priority: 63 },
  { view: 'foodOrders', title: 'Essen', category: 'Tool', description: 'Sammelbestellungen koordinieren', aliases: 'bestellung food pizza lieferdienst', priority: 68 },
  { view: 'hallOfFame', title: 'Hall of Fame', category: 'Tool', description: 'Champions vergangener Events', aliases: 'champions sieger historie ruhmeshalle', priority: 61 },
  { view: 'infoBoard', title: 'Info-Board', category: 'Tool', description: 'WLAN, Discord, Server und Hausregeln', aliases: 'info board information wlan discord server hausregeln', priority: 69 },
  { view: 'seating', title: 'Sitzplan', category: 'Tool', description: 'Plätze und sichtbare Monitore verwalten', aliases: 'sitzplatz tisch monitore nachbarn', priority: 67 },
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

export function searchEntries(query, limit = 12) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [...SEARCH_ENTRIES].sort((a, b) => b.priority - a.priority).slice(0, limit);
  }

  const terms = normalizedQuery.split(/\s+/);
  return SEARCH_ENTRIES.map((entry) => {
    const title = normalizeSearchText(entry.title);
    const haystack = normalizeSearchText(`${entry.title} ${entry.category} ${entry.description} ${entry.aliases}`);
    if (!terms.every((term) => haystack.includes(term))) return null;

    let score = entry.priority;
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
        <label class="global-search-label" for="global-search-input">Bereiche und Tools durchsuchen</label>
        <input id="global-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Zum Beispiel Captain Draft, Essen oder Sitzplan" aria-controls="global-search-results" />
        <div id="global-search-summary" class="global-search-summary" aria-live="polite"></div>
        <div id="global-search-results" class="global-search-results" role="listbox" aria-label="Suchergebnisse"></div>
        <div class="global-search-shortcuts" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> auswählen</span><span><kbd>Enter</kbd> öffnen</span><span><kbd>Esc</kbd> schließen</span></div>
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
            input.setAttribute('aria-activedescendant', selected?.id || '');
            selected?.scrollIntoView({ block: 'nearest' });
          };

          const renderResults = () => {
            results = searchEntries(input.value);
            selectedIndex = 0;
            const hasQuery = normalizeSearchText(input.value).length > 0;
            summary.textContent = hasQuery ? `${results.length} Treffer` : 'Häufig genutzte Bereiche';
            if (results.length === 0) {
              resultsContainer.innerHTML = '<div class="global-search-empty">Kein passender Bereich gefunden.</div>';
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
            onNavigate(entry.view);
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
          resultsContainer.addEventListener('pointerover', (event) => {
            const button = event.target.closest('[data-search-index]');
            if (!button) return;
            selectedIndex = Number(button.dataset.searchIndex);
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
