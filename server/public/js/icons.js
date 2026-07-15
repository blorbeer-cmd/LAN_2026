// Lucide-style line icons for UI chrome. Keeping the paths local means the
// vanilla app needs neither a CDN request nor an additional build step.
const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  vote: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-1 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98 1 1.21 1.15.54 2 2.03 2 3.79"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/>',
  lightbulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.72.66-1.34 1.21-1.94A6 6 0 1 0 7.7 12.06c.54.59 1.03 1.21 1.21 1.94Z"/>',
  library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  radioTower: '<path d="M4.9 19.1a10 10 0 0 1 0-14.2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  pause: '<rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="16" x="14" y="4" rx="1"/>',
  pin: '<path d="M12 17v5"/><path d="M5 17h14"/><path d="m15 3-1 4 3 3H7l3-3-1-4Z"/>',
  gamepad: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.9 3.11L1.15 15.25A3 3 0 0 0 4.07 19c1.24 0 2.34-.76 2.79-1.91L7.68 15h8.64l.82 2.09A3 3 0 0 0 19.93 19a3 3 0 0 0 2.92-3.75l-1.63-7.14A4 4 0 0 0 17.32 5Z"/>',
  pizza: '<path d="M15 11h.01"/><path d="M11 15h.01"/><path d="M16 16h.01"/><path d="m2 16 20-6-6 12Z"/><path d="M5.7 15.1A8 8 0 0 0 8.9 19"/>',
  utensils: '<path d="M3 2v7a3 3 0 0 0 3 3V2"/><path d="M6 2v20"/><path d="M3 6h3"/><path d="M14 2v8a3 3 0 0 0 3 3h1"/><path d="M17 2v20"/><path d="M14 6h3"/>',
  hamburger: '<path d="M3 10a9 7 0 0 1 18 0"/><path d="M3 10h18"/><path d="M4 14h16"/><path d="M3 18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2"/><path d="M5 14h14"/>',
  van: '<path d="M3 6h11v11H3z"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
  tableRowsSplit: '<path d="M3 5h8"/><path d="M3 9h8"/><path d="M3 13h5"/><path d="M3 17h5"/><path d="M15 5h6"/><path d="M15 9h6"/><path d="M15 13h6"/><path d="M15 17h6"/><path d="M12 3v18"/>',
  brain: '<path d="M9.5 3a3.5 3.5 0 0 0-3.4 4.3A3.5 3.5 0 0 0 4 13.8 3.5 3.5 0 0 0 7.5 18H9v3"/><path d="M14.5 3a3.5 3.5 0 0 1 3.4 4.3A3.5 3.5 0 0 1 20 13.8a3.5 3.5 0 0 1-3.5 4.2H15v3"/><path d="M9 7h.01"/><path d="M15 7h.01"/><path d="M9 14h.01"/><path d="M15 14h.01"/><path d="M12 3v18"/>',
  paddle: '<path d="M6 3v12"/><path d="M3 3v5a3 3 0 0 0 6 0V3"/><path d="M6 15v6"/><circle cx="18" cy="8" r="3"/><path d="m16 16 4 4"/>',
  snake: '<path d="M4 17c0-3 2-5 5-5h5c3 0 5-2 5-5"/><circle cx="19" cy="5" r="2"/><path d="M4 17h.01"/>',
  volleyball: '<circle cx="12" cy="12" r="9"/><path d="M5 6c3 1 6 0 8-3"/><path d="M3 12c3-1 6 0 8 3s5 4 8 3"/><path d="M12 21c0-3 1-5 4-7s4-5 3-8"/>',
  swords: '<path d="m14.5 17.5-11-11V3h3.5l11 11"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 19 2 2"/><path d="m14.5 6.5 4-3.5H21v3.5l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-3 3"/><path d="m3 19 2 2"/>',
  joystick: '<path d="M6 12h12a4 4 0 0 1 4 4v1a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4v-1a4 4 0 0 1 4-4Z"/><path d="M12 12V6"/><circle cx="12" cy="4" r="2"/><path d="M8 16v2"/><path d="M7 17h2"/><circle cx="17" cy="17" r="1"/>',
  car: '<path d="M19 17H5a3 3 0 0 1-3-3v-3l2-5h16l2 5v3a3 3 0 0 1-3 3Z"/><path d="M5 17v2"/><path d="M19 17v2"/><path d="M2 11h20"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3Z"/><path d="M11.6 16.6 13 22H7l-1.2-7"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V8"/><path d="M17 16V5"/>',
  landmark: '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  armchair: '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 11v8"/><path d="M21 11v8"/><path d="M5 19h14"/><path d="M5 15h14"/><path d="M3 11a2 2 0 0 1 2-2v6"/><path d="M21 11a2 2 0 0 0-2-2v6"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15 7 2 2"/><path d="m18 4 2 2"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  clipboard: '<rect width="14" height="18" x="5" y="4" rx="2"/><path d="M9 4.5V3h6v1.5"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 16H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"/><path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 12 20l1.15-1.15"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7Z"/><path d="M5 20h14"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  mapPin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  dice: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 8h.01"/><path d="M16 8h.01"/><path d="M12 12h.01"/><path d="M8 16h.01"/><path d="M16 16h.01"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" x2="21" y1="20" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" x2="21" y1="15" y2="21"/><line x1="4" x2="9" y1="4" y2="9"/>',
  scale: '<path d="m16 16 3-8 3 8a5 5 0 0 1-6 0"/><path d="m2 16 3-8 3 8a5 5 0 0 1-6 0"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h18"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  sparkles: '<path d="m12 3-1.2 3.6L7 8l3.8 1.4L12 13l1.2-3.6L17 8l-3.8-1.4Z"/><path d="m19 15-.8 2.2L16 18l2.2.8L19 21l.8-2.2L22 18l-2.2-.8Z"/><path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8Z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"/>',
  blocks: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/>',
  slash: '<path d="M5 5l14 14"/>',
  gitCommitVertical: '<circle cx="12" cy="5" r="3"/><circle cx="12" cy="19" r="3"/><path d="M12 8v8"/>',
  scanQrCode: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 7h4v4H7zM13 13h4v4h-4zM13 7h2M17 7v2M7 13h2M7 17h2"/>',
  monitorPlay: '<path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z"/><path d="M12 17v4"/><path d="M8 21h8"/><rect x="2" y="3" width="20" height="14" rx="2"/>',
  squareArrowOutUpRight: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  flame: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-2-1-3-3-3-5-3 3-4 6-4 9a7 7 0 0 0 7 7Z"/><path d="M12 22a3 3 0 0 0 3-3c0-2-1-3-2-4-1 1-2 2-2 4a3 3 0 0 0 1 3Z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  thumbsUp: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/>',
};

const EMOJI_ICONS = new Map([
  ['📌', 'pin'], ['🎮', 'gamepad'], ['🎮️', 'gamepad'], ['🎲', 'dice'], ['🕹️', 'joystick'], ['🍕', 'pizza'],
  ['🚗', 'car'], ['📢', 'megaphone'], ['👥', 'users'], ['🧑‍🤝‍🧑', 'users'], ['📊', 'chart'], ['📈', 'chart'],
  ['🏛️', 'landmark'], ['🪑', 'armchair'], ['💺', 'armchair'], ['🔑', 'key'], ['👤', 'user'], ['👋', 'user'],
  ['📋', 'clipboard'], ['✏️', 'pencil'], ['🗑️', 'trash'], ['⏱️', 'timer'], ['🕒', 'timer'], ['🕓', 'timer'], ['🕐', 'timer'],
  ['📅', 'calendar'], ['🗓️', 'calendar'], ['🔗', 'link'], ['✅', 'check'], ['✓', 'check'], ['👑', 'crown'],
  ['🏆', 'trophy'], ['🏅', 'award'], ['📡', 'radioTower'], ['🗳️', 'vote'], ['⚖️', 'shuffle'], ['⚔️', 'activity'],
  ['💡', 'lightbulb'], ['📚', 'library'], ['⭐', 'star'], ['🔥', 'activity'], ['💪', 'activity'], ['⚡', 'activity'],
  ['🖥️', 'monitor'], ['🔔', 'bell'], ['📍', 'mapPin'], ['📄', 'file'], ['📥', 'download'], ['🌐', 'globe'],
  ['🔁', 'shuffle'], ['🔢', 'chart'], ['🏃', 'activity'], ['🤹', 'activity'], ['🥊', 'activity'], ['🤝', 'users'],
  ['😱', 'sparkles'], ['🎉', 'sparkles'], ['🎪', 'sparkles'], ['🏟️', 'trophy'], ['🏁', 'check'], ['📱', 'monitor'],
  ['🟢', 'radioTower'], ['🔴', 'radioTower'], ['⚪', 'circleCheck'], ['⏸', 'pause'], ['⏸️', 'pause'], ['▶️', 'activity'],
  ['🚫', 'pause'], ['🫵', 'user'], ['☰', 'library'], ['⚙️', 'library'], ['✕', 'x'], ['❌', 'x'],
  ['›', 'chevronRight'], ['‹', 'chevronLeft'], ['▶️', 'play'], ['🔫', 'crosshair'], ['🛡️', 'shield'], ['⛳', 'flag'],
  ['🧩', 'blocks'], ['🏓', 'paddle'], ['🏐', 'volleyball'], ['🐍', 'snake'],
]);

const EMOJI_PATTERN = /(?:🧑‍🤝‍🧑|[›‹]|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}])\uFE0F?/gu;

export function icon(name, { className = '', label = '' } = {}) {
  const paths = ICONS[name];
  if (!paths) return '';
  const aria = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="ui-icon${className ? ` ${className}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${aria}>${paths}</svg>`;
}

export function iconForGame(game, options) {
  const name = String(game?.name || game?.game_name || '').toLowerCase();
  const iconName = /counter|valorant|overwatch|quake|doom|shooter|battlefield|call of duty/.test(name)
    ? 'crosshair'
    : /rocket league|racing|race|kart|forza/.test(name)
      ? 'car'
      : /warcraft|league of legends|dota|strategy/.test(name)
        ? 'shield'
        : /golf/.test(name)
          ? 'flag'
          : /quiz|trivia/.test(name)
            ? 'lightbulb'
            : /tetris|minecraft|bau/.test(name)
              ? 'blocks'
              : 'gamepad';
  return icon(iconName, options);
}

function replaceTextNode(node) {
  if (!EMOJI_PATTERN.test(node.data)) return;
  EMOJI_PATTERN.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of node.data.matchAll(EMOJI_PATTERN)) {
    if (match.index > last) fragment.append(node.data.slice(last, match.index));
    const iconName = EMOJI_ICONS.get(match[0]) || EMOJI_ICONS.get(match[0].replace(/\uFE0F/g, '')) || 'sparkles';
    const holder = document.createElement('span');
    holder.className = 'inline-icon';
    holder.innerHTML = icon(iconName);
    fragment.append(holder);
    last = match.index + match[0].length;
  }
  if (last < node.data.length) fragment.append(node.data.slice(last));
  node.replaceWith(fragment);
}

export function replaceEmojiIcons(root = document) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (parent?.closest('option')) {
      walker.currentNode.data = walker.currentNode.data.replace(EMOJI_PATTERN, '').replace(/^\s+/, '');
      EMOJI_PATTERN.lastIndex = 0;
    } else if (parent && !parent.closest('script, style, textarea, input, .brand-title')) {
      nodes.push(walker.currentNode);
    }
  }
  nodes.forEach(replaceTextNode);
}

export function installIconReplacement() {
  replaceEmojiIcons(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) replaceTextNode(node);
        else if (node.nodeType === Node.ELEMENT_NODE && !node.matches('.inline-icon, .inline-icon *')) replaceEmojiIcons(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
