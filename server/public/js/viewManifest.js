// Static source of truth for every route. Render functions and cache handlers
// are attached in viewRegistry.js, while labels, sections, permissions, icons,
// search/navigation metadata and lifecycle dependencies stay data-only here.

const CORE_REALTIME_EVENTS = Object.freeze({
  players: 'players:changed',
  games: 'games:changed',
  skills: 'skills:changed',
  leaderboard: 'leaderboard:changed',
  events: 'events:changed',
});

function defineView(definition) {
  return Object.freeze({
    area: 'core',
    requiresRole: null,
    eventFeature: null,
    ...definition,
    lifecycle: Object.freeze({
      eventScoped: false,
      invalidateOn: Object.freeze([]),
      refreshOn: Object.freeze([]),
      preserveState: true,
      ...(definition.lifecycle ?? {}),
    }),
  });
}

function search(category, description, aliases, priority) {
  return Object.freeze({ category, description, aliases, priority });
}

const REFRESH_ON = Object.freeze({
  home: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.skills, CORE_REALTIME_EVENTS.leaderboard, CORE_REALTIME_EVENTS.events],
  matchmaking: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.skills, CORE_REALTIME_EVENTS.leaderboard],
  votes: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games],
  leaderboard: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.leaderboard],
  analytics: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.leaderboard, CORE_REALTIME_EVENTS.events],
  profile: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.skills, CORE_REALTIME_EVENTS.events],
  tournaments: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.skills],
  hallOfFame: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.leaderboard, CORE_REALTIME_EVENTS.events],
  seating: [CORE_REALTIME_EVENTS.players],
  myStats: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.leaderboard, CORE_REALTIME_EVENTS.events],
  broadcast: [CORE_REALTIME_EVENTS.players],
  foodOrders: [CORE_REALTIME_EVENTS.players],
  checklist: [CORE_REALTIME_EVENTS.players],
  checklistPacking: [CORE_REALTIME_EVENTS.players],
  gameCatalog: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.skills, CORE_REALTIME_EVENTS.leaderboard],
  // The times table renders the accepted participant set from the event
  // snapshot, so invitation acceptance/withdrawal changes this view even when
  // the arrivals endpoint itself emits no signal.
  arrivals: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.events],
  events: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.events],
  admin: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.events],
  adminFeatureUsage: [CORE_REALTIME_EVENTS.players],
});

function lifecycle(view, options = {}) {
  const invalidateOn = [...(options.invalidateOn ?? [])];
  if (options.eventScoped) invalidateOn.push('event-context:changed');
  if (options.reconnect) invalidateOn.push('connection:restored');
  return Object.freeze({
    eventScoped: options.eventScoped ?? false,
    invalidateOn: Object.freeze([...new Set(invalidateOn)]),
    refreshOn: Object.freeze(REFRESH_ON[view] ?? []),
    preserveState: options.preserveState ?? true,
  });
}

export const SECTION_MANIFEST = Object.freeze({
  competition: Object.freeze({ label: 'Match', iconKey: 'swords' }),
  insights: Object.freeze({ label: 'Auswertung', iconKey: 'trophy' }),
  orga: Object.freeze({
    label: 'Orga',
    iconKey: 'clipboard',
    navigation: Object.freeze({ more: Object.freeze({ eventTypes: Object.freeze(['lan']), order: 5 }) }),
  }),
});

export const VIEW_MANIFEST = Object.freeze({
  home: defineView({
    label: 'Home', iconKey: 'house',
    search: search('Bereich', 'Aktuelles, Live-Status und Überblick', 'start übersicht dashboard', 100),
    navigation: Object.freeze({ bottom: Object.freeze({ lan: Object.freeze({ order: 0, ariaLabel: 'Home' }), general: Object.freeze({ order: 0, ariaLabel: 'Home' }) }) }),
    lifecycle: lifecycle('home', { eventScoped: true, reconnect: true, invalidateOn: [
      CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.skills,
      'live:changed', 'tournaments:changed', 'push:sent', 'foodOrders:changed',
      'arcade:lobbies-changed', 'visibility:changed',
    ] }),
  }),
  matchmaking: defineView({
    label: 'Teams', section: 'competition', sectionOrder: 0, iconKey: 'scale', eventFeature: 'competition',
    search: search('Match', 'Auslosen, Captain Draft und Historie', 'match wettkampf teams auslosen matchmaking captain draft kraft team-historie ergebnis-historie', 98),
    navigation: Object.freeze({ bottom: Object.freeze({ lan: Object.freeze({ order: 1, label: 'Match', ariaLabel: 'Match: Teams und Turniere', iconKey: 'competition' }) }) }),
    lifecycle: lifecycle('matchmaking', { eventScoped: true, reconnect: true, invalidateOn: [
      CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.leaderboard,
      'matchmaking:generated', 'matchmaking:draws-changed', 'draft:changed',
    ] }),
  }),
  votes: defineView({
    label: 'Vote', iconKey: 'vote', eventFeature: 'games',
    search: search('Bereich', 'Gemeinsam das nächste Spiel wählen', 'abstimmung voting punkte spielwahl', 97),
    navigation: Object.freeze({ bottom: Object.freeze({ lan: Object.freeze({ order: 2, ariaLabel: 'Abstimmung' }) }) }),
    lifecycle: lifecycle('votes', { eventScoped: true, reconnect: true, invalidateOn: ['votes:closed'] }),
  }),
  leaderboard: defineView({
    label: 'Rangliste', section: 'insights', sectionOrder: 0, iconKey: 'trophy', requiresRole: 'admin', deniedView: 'foodOrders', eventFeature: 'tracking',
    search: search('Auswertung', 'Ergebnisse, Punkte und Platzierungen', 'auswertung rang leaderboard ergebnis match', 96),
    lifecycle: lifecycle('leaderboard', { eventScoped: true }),
  }),
  events: defineView({
    label: 'Events', section: 'orga', sectionOrder: 2, iconKey: 'calendar',
    search: search('Orga', 'Events anlegen, Tracking und Teilnehmer verwalten', 'orga einstellungen setup konfiguration tracking teilnehmer einladung', 85),
    navigation: Object.freeze({ more: Object.freeze({ eventTypes: Object.freeze(['general']), order: 5 }) }),
    lifecycle: lifecycle('events'),
  }),
  eventPolls: defineView({
    label: 'Umfragen', section: 'orga', sectionOrder: 0, iconKey: 'vote',
    search: search('Orga', 'Zeitraum, Ort, Dauer und Budget gemeinsam planen', 'orga umfrage termin ort unterkunft dauer budget planung interessiert', 86),
    navigation: Object.freeze({ bottom: Object.freeze({ general: Object.freeze({ order: 4, labelBreakAfter: 6, ariaLabel: 'Umfragen' }) }) }),
    lifecycle: lifecycle('eventPolls', { eventScoped: true, invalidateOn: [CORE_REALTIME_EVENTS.events] }),
  }),
  kiosk: defineView({
    label: 'TV-Kiosk', iconKey: 'monitor', requiresRole: 'admin', eventFeature: 'kiosk',
    search: search('Bereich', 'TV-/Kiosk-Ansicht öffnen', 'admin einstellungen tv bildschirm dashboard kiosk-ansicht', 62),
  }),
  analytics: defineView({
    label: 'Statistiken', section: 'insights', sectionOrder: 1, iconKey: 'chart', requiresRole: 'admin', deniedView: 'foodOrders', eventFeature: 'tracking',
    search: search('Auswertung', 'Awards und gemeinsame Statistiken', 'auswertung auswertungen analytics statistik awards spielzeit', 64),
    lifecycle: lifecycle('analytics', { eventScoped: true }),
  }),
  profile: defineView({
    label: 'Mein Profil', iconKey: 'circleUser',
    search: search('Bereich', 'Profil, Agent und Push-Benachrichtigungen', 'account ich agent benachrichtigung', 90),
    navigation: Object.freeze({ more: Object.freeze({ eventTypes: Object.freeze(['lan', 'general']), order: 0 }) }),
    lifecycle: lifecycle('profile', { eventScoped: true }),
  }),
  tournaments: defineView({
    label: 'Turniere', section: 'competition', sectionOrder: 1, iconKey: 'swords', eventFeature: 'competition',
    search: search('Match', 'Turniere anlegen und Ergebnisse verwalten', 'match wettkampf tournament ko runde bracket', 99),
    lifecycle: lifecycle('tournaments', { eventScoped: true, reconnect: true, invalidateOn: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.leaderboard, 'tournaments:changed'] }),
  }),
  hallOfFame: defineView({
    label: 'Hall of Fame', section: 'insights', sectionOrder: 2, iconKey: 'landmark', requiresRole: 'admin', deniedView: 'foodOrders', eventFeature: 'tracking',
    search: search('Auswertung', 'Champions vergangener Events', 'auswertung champions sieger historie ruhmeshalle', 61),
    lifecycle: lifecycle('hallOfFame', { eventScoped: true, reconnect: true, invalidateOn: [CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.leaderboard] }),
  }),
  seating: defineView({
    label: 'Sitzplan', iconKey: 'armchair', requiresRole: 'admin', eventFeature: 'seating',
    search: search('Bereich', 'Plätze und sichtbare Monitore verwalten', 'sitzplatz tisch monitore nachbarn', 67),
    lifecycle: lifecycle('seating', { eventScoped: true, reconnect: true, invalidateOn: [CORE_REALTIME_EVENTS.players, 'visibility:changed'] }),
  }),
  myStats: defineView({
    label: 'Meine Statistiken', iconKey: 'chart', eventFeature: 'tracking',
    search: search('Bereich', 'Eigene Spielzeit und persönliche Werte', 'stats spielzeit auswertung', 80),
    lifecycle: lifecycle('myStats', { eventScoped: true }),
  }),
  more: defineView({
    label: 'Mehr', iconKey: 'menu',
    search: search('Bereich', 'Alle weiteren Bereiche und Tools', 'menü tools', 95),
    navigation: Object.freeze({ bottom: Object.freeze({ lan: Object.freeze({ order: 5, ariaLabel: 'Mehr' }), general: Object.freeze({ order: 5, ariaLabel: 'Mehr' }) }) }),
  }),
  broadcast: defineView({
    label: 'Durchsage', iconKey: 'megaphone',
    search: search('Bereich', 'Eine Mitteilung an alle Geräte senden', 'ansage nachricht push kiosk', 63),
    navigation: Object.freeze({ more: Object.freeze({ eventTypes: Object.freeze(['lan', 'general']), order: 3 }) }),
    lifecycle: lifecycle('broadcast', { eventScoped: true, reconnect: true, invalidateOn: [CORE_REALTIME_EVENTS.players, 'broadcast:new', 'broadcasts:changed'] }),
  }),
  foodOrders: defineView({
    label: 'Essen', iconKey: 'hamburger', eventFeature: 'food',
    search: search('Bereich', 'Sammelbestellungen koordinieren', 'bestellung food pizza lieferdienst', 68),
    navigation: Object.freeze({
      bottom: Object.freeze({ lan: Object.freeze({ order: 3, ariaLabel: 'Essen: Sammelbestellungen koordinieren', id: 'nav-food-orders' }) }),
      more: Object.freeze({ eventTypes: Object.freeze(['general']), order: 6 }),
    }),
    lifecycle: lifecycle('foodOrders', { eventScoped: true, reconnect: true, invalidateOn: [CORE_REALTIME_EVENTS.players, 'foodOrders:changed'] }),
  }),
  checklist: defineView({
    label: 'To-Do', section: 'orga', sectionOrder: 4, iconKey: 'listChecks', eventFeature: 'tasks',
    search: search('Orga', 'Aufgaben und Mitbring-Anfragen der Gruppe', 'orga checkliste todo aufgabe anfrage mitbringen', 66),
    navigation: Object.freeze({ bottom: Object.freeze({ general: Object.freeze({ order: 3, ariaLabel: 'To-Do' }) }) }),
    lifecycle: lifecycle('checklist', { eventScoped: true, reconnect: true, invalidateOn: [CORE_REALTIME_EVENTS.players, 'checklist:changed'] }),
  }),
  checklistPacking: defineView({
    label: 'Packliste', section: 'orga', sectionOrder: 3, iconKey: 'clipboard', eventFeature: 'tasks',
    search: search('Orga', 'Persönliche Packliste für die LAN', 'orga checkliste packen mitnehmen', 66),
    navigation: Object.freeze({ bottom: Object.freeze({ general: Object.freeze({ order: 2, ariaLabel: 'Packliste' }) }) }),
    lifecycle: lifecycle('checklistPacking', { eventScoped: true }),
  }),
  gameCatalog: defineView({
    label: 'Spiele', iconKey: 'gamepad', eventFeature: 'games',
    search: search('Bereich', 'Bock, Skill und Spielekatalog', 'games katalog bewertung skill bock', 75),
    navigation: Object.freeze({ bottom: Object.freeze({ lan: Object.freeze({ order: 4, ariaLabel: 'Spiele' }) }) }),
    lifecycle: lifecycle('gameCatalog', { reconnect: true, invalidateOn: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.games, CORE_REALTIME_EVENTS.skills, CORE_REALTIME_EVENTS.leaderboard] }),
  }),
  arrivals: defineView({
    label: 'An- & Abreise', section: 'orga', sectionOrder: 1, iconKey: 'van', eventFeature: 'travel',
    search: search('Orga', 'Zeiten und Fahrgemeinschaften planen', 'orga anreise abreise ankunft abfahrt fahrt carpool', 65),
    navigation: Object.freeze({ bottom: Object.freeze({ general: Object.freeze({ order: 1, label: 'An & Abreise', ariaLabel: 'An- und Abreise' }) }) }),
    lifecycle: lifecycle('arrivals', { eventScoped: true, reconnect: true, invalidateOn: [CORE_REALTIME_EVENTS.players, CORE_REALTIME_EVENTS.events, 'arrivals:changed'] }),
  }),
  admin: defineView({
    label: 'Admin', iconKey: 'shield', requiresRole: 'admin',
    search: search('Bereich', 'Einladungslink, Sitzplan, Backup, Test-Spieler, Rechte und Diagnose', 'moderation verwaltung diagnose einladung invite sitzplan backup', 60),
    navigation: Object.freeze({ more: Object.freeze({ eventTypes: Object.freeze(['lan', 'general']), order: 1 }) }),
    lifecycle: lifecycle('admin', { eventScoped: true, reconnect: true, invalidateOn: [CORE_REALTIME_EVENTS.events, 'groups:changed'] }),
  }),
  adminFeatureUsage: defineView({
    label: 'Nutzungsauswertung', iconKey: 'chart', requiresRole: 'admin', deniedView: 'foodOrders',
    lifecycle: lifecycle('adminFeatureUsage', { eventScoped: true }),
  }),
  adminFeedback: defineView({ label: 'Feedback', iconKey: 'messageSquare', requiresRole: 'admin', deniedView: 'foodOrders' }),
  music: defineView({
    label: 'Jam', iconKey: 'music', eventFeature: 'music',
    search: search('Bereich', 'Spotify-Titel und Playlists gemeinsam abspielen', 'spotify musik songs playlist queue warteschlange', 64),
    navigation: Object.freeze({ more: Object.freeze({ eventTypes: Object.freeze(['lan', 'general']), order: 4 }) }),
    lifecycle: lifecycle('music', { eventScoped: true, reconnect: true, invalidateOn: ['music:changed', 'visibility:changed'] }),
  }),
  arcade: defineView({
    area: 'arcade', label: 'Arcade', iconKey: 'joystick', eventFeature: 'arcade', module: './arcade/views/arcade.js', exportName: 'renderArcade',
    search: search('Bereich', 'Minigame-Lobbies öffnen und mitspielen', 'quiz tetris scribble pong blobby snake minigame', 74),
    navigation: Object.freeze({ more: Object.freeze({ eventTypes: Object.freeze(['lan', 'general']), order: 2 }) }),
  }),
  arcadeWatch: defineView({ area: 'arcade', label: 'Arcade-Zuschauen', iconKey: 'joystick', eventFeature: 'arcade', module: './arcade/views/arcadeWatch.js', exportName: 'renderArcadeWatch' }),
  quizRoom: defineView({ area: 'arcade', label: 'Quiz', iconKey: 'joystick', eventFeature: 'arcade', module: './arcade/views/arcade.js', exportName: 'renderQuizRoom' }),
  tetris: defineView({ area: 'arcade', label: 'Tetris', iconKey: 'joystick', eventFeature: 'arcade', module: './arcade/views/tetris.js', exportName: 'renderTetris' }),
  scribbleRoom: defineView({ area: 'arcade', label: 'Scribble', iconKey: 'joystick', eventFeature: 'arcade', module: './arcade/views/arcadeScribble.js', exportName: 'renderScribbleRoom' }),
  blobby: defineView({ area: 'arcade', label: 'Blobby Volley', iconKey: 'joystick', eventFeature: 'arcade', module: './arcade/views/blobby.js', exportName: 'renderBlobby' }),
  pong: defineView({ area: 'arcade', label: 'Pong', iconKey: 'joystick', eventFeature: 'arcade', module: './arcade/views/pong.js', exportName: 'renderPong' }),
  snake: defineView({ area: 'arcade', label: 'Snake', iconKey: 'joystick', eventFeature: 'arcade', module: './arcade/views/snake.js', exportName: 'renderSnake' }),
  battleship: defineView({ area: 'arcade', label: 'Schiffe versenken', iconKey: 'joystick', eventFeature: 'arcade', module: './arcade/views/battleship.js', exportName: 'renderBattleship' }),
  challengeRush: defineView({ area: 'arcade', label: 'Challenge Rush', iconKey: 'joystick', eventFeature: 'arcade', module: './arcade/views/challengeRush.js', exportName: 'renderChallengeRush' }),
});

export function viewDefinition(view) {
  return VIEW_MANIFEST[view] ?? null;
}

export function sectionViews(sectionKey) {
  return Object.entries(VIEW_MANIFEST)
    .filter(([, definition]) => definition.section === sectionKey)
    .sort(([, a], [, b]) => a.sectionOrder - b.sectionOrder)
    .map(([view, definition]) => Object.freeze({ view, label: definition.label }));
}

export function searchableViewEntries() {
  return Object.entries(VIEW_MANIFEST)
    .filter(([, definition]) => definition.search)
    .map(([view, definition]) => Object.freeze({
      view,
      title: definition.label,
      ...definition.search,
      ...(definition.requiresRole === 'admin' ? { adminOnly: true } : {}),
    }));
}

export function bottomNavigationEntries(eventType = 'lan') {
  return Object.entries(VIEW_MANIFEST)
    .flatMap(([view, definition]) => {
      const navigation = definition.navigation?.bottom?.[eventType];
      if (!navigation) return [];
      return [{
        view,
        label: navigation.label ?? definition.label,
        ariaLabel: navigation.ariaLabel ?? navigation.label ?? definition.label,
        // Navigation carries semantic domain keys. domainIcons.js remains the
        // single resolver from those stable meanings to concrete Lucide names.
        iconKey: navigation.iconKey ?? view,
        ...navigation,
      }];
    })
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...entry }) => Object.freeze(entry));
}

export function moreNavigationEntries(eventType = 'lan') {
  const views = Object.entries(VIEW_MANIFEST).flatMap(([view, definition]) => {
    const navigation = definition.navigation?.more;
    if (!navigation?.eventTypes.includes(eventType)) return [];
    return [{ view, title: definition.label, iconKey: view, requiresRole: definition.requiresRole, order: navigation.order }];
  });
  const sections = Object.entries(SECTION_MANIFEST).flatMap(([section, definition]) => {
    const navigation = definition.navigation?.more;
    if (!navigation?.eventTypes.includes(eventType)) return [];
    return [{ section, title: definition.label, iconKey: section, order: navigation.order }];
  });
  return [...views, ...sections]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...entry }) => Object.freeze(entry));
}

export function createLazyRenderer(modulePath, exportName, importer) {
  let pending = null;
  let retry = 0;
  return async () => {
    if (!pending) {
      const separator = modulePath.includes('?') ? '&' : '?';
      const requestPath = retry === 0 ? modulePath : `${modulePath}${separator}arcade-retry=${retry}`;
      pending = importer(requestPath).then((loaded) => {
        const renderer = loaded?.[exportName];
        if (typeof renderer !== 'function') throw new Error(`Arcade-Modul ${modulePath} exportiert ${exportName} nicht.`);
        return renderer;
      });
    }
    try {
      return await pending;
    } catch (error) {
      pending = null;
      retry += 1;
      throw error;
    }
  };
}

export function createViewRegistry(coreRenderers, lifecycleHandlers = {}, importer = (modulePath) => import(modulePath)) {
  const registry = {};
  for (const [name, definition] of Object.entries(VIEW_MANIFEST)) {
    const handlers = lifecycleHandlers[name] ?? {};
    if (definition.area === 'arcade') {
      registry[name] = Object.freeze({
        ...definition,
        lifecycleHandlers: Object.freeze(handlers),
        resolveRenderer: createLazyRenderer(definition.module, definition.exportName, importer),
      });
      continue;
    }
    const render = coreRenderers[name];
    if (typeof render !== 'function') throw new Error(`Core-Renderer fehlt: ${name}`);
    registry[name] = Object.freeze({ ...definition, lifecycleHandlers: Object.freeze(handlers), render });
  }
  return Object.freeze(registry);
}

export { CORE_REALTIME_EVENTS };
