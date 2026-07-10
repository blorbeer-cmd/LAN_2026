// "Mehr" hub: the secondary destinations (Spieler-Verwaltung, Auswertungen,
// Hall of Fame, Sitzplan) each get their own clear entry point here, leaving
// the bottom nav to the things people reach for constantly during the party
// (tournaments earned that spot; the roster is mostly a setup-time concern
// since everyone self-onboards through their profile).

import { icon } from '../icons.js';

const ITEMS = [
  { view: 'infoBoard', icon: 'pin', title: 'Info-Board', desc: 'WLAN, Discord, Server-IPs, Hausregeln – alles Wichtige an einem Ort.' },
  { view: 'gameCatalog', icon: 'gamepad', title: 'Spiele', desc: 'Alle Spiele: Bock & Skill eintragen, vorschlagen, verwalten.' },
  { view: 'foodOrders', icon: 'hamburger', title: 'Essen bestellen', desc: 'Sammelbestellung öffnen, jeder trägt sich selbst ein.' },
  { view: 'arcade', icon: 'joystick', title: 'Arcade', desc: 'Mini-Games starten, aktuell mit Mehrspieler-Gaming-Quiz.' },
  { view: 'arrivals', icon: 'van', title: 'An- & Abreise', desc: 'Wann kommst/gehst du, plus Fahrgemeinschaften.' },
  { view: 'broadcast', icon: 'megaphone', title: 'Durchsage', desc: 'Eine Nachricht an alle Geräte, den Kiosk und als Push.' },
  { view: 'players', icon: 'users', title: 'Spieler', desc: 'Alle Teilnehmer: anlegen, umbenennen, Agent-Keys nachschlagen.' },
  { view: 'analytics', icon: 'chart', title: 'Auswertungen', desc: 'Spielzeit, Awards und Match-/Turnier-Statistiken, Rivalitäten, Duos.' },
  { view: 'hallOfFame', icon: 'landmark', title: 'Hall of Fame', desc: 'Champions über alle LAN-Partys hinweg.' },
  { view: 'seating', icon: 'tableRowsSplit', title: 'Sitzplan', desc: 'Wer neben wem sitzt, gruppiert aus den Profilangaben.' },
  { view: 'admin', icon: 'shield', title: 'Admin', desc: 'Test-Spieler anlegen, Admin vergeben, moderieren.' },
];

export function renderMore(container) {
  const rows = ITEMS.map(
    (item) => `
    <button type="button" class="card row list-row" data-navigate="${item.view}">
      <span class="list-row-icon">${icon(item.icon)}</span>
      <span style="flex:1;">
        <div class="player-name">${item.title}</div>
        <div class="muted list-row-desc">${item.desc}</div>
      </span>
      <span class="muted">›</span>
    </button>`
  ).join('');

  container.innerHTML = `
    <h1 class="view-title">Mehr</h1>
    <div class="card-grid">${rows}</div>
  `;
}
