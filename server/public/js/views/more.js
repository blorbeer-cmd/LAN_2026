// "Mehr" hub: the secondary destinations (Auswertungen, Turniere, Hall of
// Fame, Sitzplan) used to live as buttons crammed into the Rangliste
// header — this gives each its own clear entry point instead, and leaves
// room to add more later without the bottom nav running out of icons.

const ITEMS = [
  { view: 'analytics', icon: '📊', title: 'Auswertungen', desc: 'Awards, Spielzeiten, wer wann was gespielt hat.' },
  { view: 'tournaments', icon: '🏆', title: 'Turniere', desc: 'Turnierbäume und Ligen erstellen und verfolgen.' },
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
    <div class="stack">${rows}</div>
  `;
}
