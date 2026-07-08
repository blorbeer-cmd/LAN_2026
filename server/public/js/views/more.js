// "Mehr" hub: the secondary destinations (Spieler-Verwaltung, Auswertungen,
// Hall of Fame, Sitzplan) each get their own clear entry point here, leaving
// the bottom nav to the things people reach for constantly during the party
// (tournaments earned that spot; the roster is mostly a setup-time concern
// since everyone self-onboards through their profile).

const ITEMS = [
  { view: 'players', icon: '👥', title: 'Spieler', desc: 'Alle Teilnehmer: anlegen, umbenennen, Agent-Keys nachschlagen.' },
  { view: 'analytics', icon: '🕒', title: 'Spielzeit-Auswertungen', desc: 'Awards, Spielzeiten, beliebteste Spiele, wer wann was gespielt hat.' },
  { view: 'gameStats', icon: '📊', title: 'Spiele & Turniere', desc: 'Match- und Turnier-Statistiken, Rivalitäten, Duos, Underdog-Siege.' },
  { view: 'hallOfFame', icon: '🏛️', title: 'Hall of Fame', desc: 'Champions über alle LAN-Partys hinweg.' },
  { view: 'seating', icon: '🪑', title: 'Sitzplan', desc: 'Wer neben wem sitzt, gruppiert aus den Profilangaben.' },
];

export function renderMore(container) {
  const rows = ITEMS.map(
    (item) => `
    <button type="button" class="card row" style="width:100%;text-align:left;cursor:pointer;" data-navigate="${item.view}">
      <span style="font-size:1.6rem;">${item.icon}</span>
      <span style="flex:1;">
        <div class="player-name">${item.title}</div>
        <div class="muted" style="font-size:0.8rem;">${item.desc}</div>
      </span>
      <span class="muted">›</span>
    </button>`
  ).join('');

  container.innerHTML = `
    <h1 class="view-title">Mehr</h1>
    <div class="card-grid">${rows}</div>
  `;
}
