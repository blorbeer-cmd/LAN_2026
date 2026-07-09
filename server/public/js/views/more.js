// "Mehr" hub: the secondary destinations (Spieler-Verwaltung, Auswertungen,
// Hall of Fame, Sitzplan) each get their own clear entry point here, leaving
// the bottom nav to the things people reach for constantly during the party
// (tournaments earned that spot; the roster is mostly a setup-time concern
// since everyone self-onboards through their profile).

const ITEMS = [
  { view: 'infoBoard', icon: '📌', title: 'Info-Board', desc: 'WLAN, Discord, Server-IPs, Hausregeln – alles Wichtige an einem Ort.' },
  { view: 'foodOrders', icon: '🍕', title: 'Essen bestellen', desc: 'Sammelbestellung öffnen, jeder trägt sich selbst ein.' },
  { view: 'arrivals', icon: '🚗', title: 'An- & Abreise', desc: 'Wann kommst/gehst du, plus Fahrgemeinschaften.' },
  { view: 'broadcast', icon: '📢', title: 'Durchsage', desc: 'Eine Nachricht an alle Geräte, den Kiosk und als Push.' },
  { view: 'players', icon: '👥', title: 'Spieler', desc: 'Alle Teilnehmer: anlegen, umbenennen, Agent-Keys nachschlagen.' },
  { view: 'analytics', icon: '🕒', title: 'Spielzeit-Auswertungen', desc: 'Awards, Spielzeiten, beliebteste Spiele, wer wann was gespielt hat.' },
  { view: 'gameStats', icon: '📊', title: 'Spiele & Turniere', desc: 'Match- und Turnier-Statistiken, Rivalitäten, Duos, Underdog-Siege.' },
  { view: 'hallOfFame', icon: '🏛️', title: 'Hall of Fame', desc: 'Champions über alle LAN-Partys hinweg.' },
  { view: 'seating', icon: '🪑', title: 'Sitzplan', desc: 'Wer neben wem sitzt, gruppiert aus den Profilangaben.' },
];

export function renderMore(container) {
  const rows = ITEMS.map(
    (item) => `
    <button type="button" class="card row list-row" data-navigate="${item.view}">
      <span class="list-row-icon">${item.icon}</span>
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
