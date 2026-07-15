// "Mehr" hub: the secondary destinations (Spieler-Verwaltung, Auswertungen,
// Hall of Fame, Sitzplan) each get their own clear entry point here, leaving
// the bottom nav to the things people reach for constantly during the party
// (tournaments earned that spot; the roster is mostly a setup-time concern
// since everyone self-onboards through their profile).

import { icon } from '../icons.js';
import { domainIcon } from '../domainIcons.js';

const ITEMS = [
  { view: 'admin', title: 'Admin', desc: 'Test-Spieler anlegen, Admin vergeben, moderieren.' },
  { view: 'arrivals', title: 'An- & Abreise', desc: '' },
  { view: 'arcade', title: 'Arcade', desc: 'Minigame-Lobbies' },
  { view: 'analytics', title: 'Auswertungen', desc: 'Awards und Statistiken' },
  { view: 'broadcast', title: 'Durchsage', desc: 'Eine Nachricht an alle Geräte, den Kiosk und als Push.' },
  { view: 'foodOrders', title: 'Essen', desc: 'Sammelbestellung öffnen, jeder trägt sich selbst ein.' },
  { view: 'hallOfFame', title: 'Hall of Fame', desc: 'Champions über alle LAN-Partys hinweg.' },
  { view: 'infoBoard', title: 'Info-Board', desc: 'WLAN, Discord, Server-IPs, Hausregeln – alles Wichtige an einem Ort.' },
  { view: 'players', title: 'Spieler', desc: 'Alle Teilnehmer: anlegen, umbenennen, Agent-Keys nachschlagen.' },
  { view: 'gameCatalog', title: 'Spiele', desc: 'Alle Spiele: Bock & Skill eintragen, vorschlagen, verwalten.' },
];

export function renderMore(container) {
  const rows = ITEMS.map(
    (item) => `
    <button type="button" class="card row list-row" data-navigate="${item.view}">
      <span class="list-row-icon">${icon(domainIcon(item.view))}</span>
      <span style="flex:1;">
        <div class="player-name">${item.title}</div>
        ${item.desc ? `<div class="muted list-row-desc">${item.desc}</div>` : ''}
      </span>
      <span class="muted">›</span>
    </button>`
  ).join('');

  container.innerHTML = `
    <h1 class="view-title">Mehr</h1>
    <div class="card-grid">${rows}</div>
  `;
}
