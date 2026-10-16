// Data contracts of the real views, never substitute card/form markup.
export const DEMO_VIEWS = ['gameCatalog', 'votes', 'eventPolls', 'arrivals', 'checklist', 'checklistPacking', 'foodOrders', 'matchmaking'];

export function createTourDemo(view, stepId, { admin = false, event = null } = {}, now = Date.now()) {
  if (!DEMO_VIEWS.includes(view)) return null;
  const [chapter, step] = stepId.split('/');
  const me = { id: 'tour-alex', name: 'Alex', is_admin: admin ? 1 : 0 };
  const players = [me, ...['Sam', 'Kim', 'Jo'].map((name) => ({ id: `tour-${name.toLowerCase()}`, name, is_admin: 0 }))];
  const games = ['Rocket League', 'Counter-Strike 2', 'Trackmania'].map((name, index) => ({
    id: `tour-game-${index}`, name, icon: '', platform: 'Steam', platform_url: null, trailer_url: null,
    genres: index === 0 ? ['Sport'] : [], info: index === 0 ? 'Controller empfohlen' : '',
    isSuggestion: false, considerSeatNeighborsDefault: false, processNames: [], min_team_size: 1, max_team_size: 4,
  }));
  if (view === 'gameCatalog' && step === 'promote') games[0].isSuggestion = true;
  if (view === 'gameCatalog' && step === 'process') games[0].processNames = ['RocketLeague.exe'];
  const start = now + 7 * 86_400_000;
  const activeEvent = { ...event, id: 'tour-event', name: 'Beispiel-LAN', type: event?.type ?? 'lan',
    startsAt: start, endsAt: start + 2 * 86_400_000, participantIds: players.map((p) => p.id),
    enabledFeatures: event?.enabledFeatures, status: 'published', accepted: true };
  const preferences = games.map((game, index) => ({ player_id: me.id, game_id: game.id, rating: [4, 2, 0][index] }));
  const skills = players.flatMap((player, index) => games.map((game) => ({ player_id: player.id, game_id: game.id, rating: [4, 3, 2, 3][index] })));
  const results = games.map((game, index) => ({ gameId: game.id, gameName: game.name, gameIcon: '', points: [12, 8, 2][index], votes: [3, 2, 1][index], avgBock: [4, 2, 0][index] }));
  const round = { round: 1, title: 'Samstagabend', info: 'Was spielen wir als Nächstes?', mode: 'points',
    open: true, startedAt: now - 600_000, createdBy: me.id, anonymous: false, hideLiveResults: true,
    results, totalVoters: 0, sourceRound: null };
  const history = { ...round, open: false, endedAt: now, totalVoters: 3, winnerGameIds: [games[0].id],
    ballots: players.slice(0, 3).map((p, voter) => ({ playerId: p.id, name: p.name,
      entries: games.map((g, i) => ({ gameId: g.id, points: [[4, 2, 0], [5, 3, 1], [3, 3, 1]][voter][i] })) })) };
  const submitted = ['submitted', 'replace'].includes(step);
  if (chapter === 'result' && step === 'runoff') {
    results[1].points = 12;
    history.ballots.forEach((ballot) => { ballot.entries[1].points = 4; });
    history.winnerGameIds = games.slice(0, 2).map((game) => game.id);
  }
  const finished = chapter === 'result';
  const pollClosed = ['result', 'close', 'round'].includes(step);
  const pollVoters = pollClosed ? players : players.slice(0, 3);
  const poll = { id: 'tour-poll', decisionKey: 'tour-poll', title: 'Was essen wir am Samstag?', note: 'Bitte bis Freitag antworten',
    responseMode: 'single_choice', status: pollClosed ? 'closed' : 'open', roundNumber: 1, maxSelections: null,
    createdBy: me.id, createdByName: me.name, updatedAt: now, createdAt: now - 600_000, responseDueAt: start - 86_400_000,
    isInvitee: true, canManage: true, canDelete: admin, anonymous: false, liveResultsHidden: true,
    resultsVisible: true, responseDetailsVisible: true,
    hasResponses: true, myResponses: { 'tour-pizza': 'can', 'tour-burger': 'cannot' },
    invitees: players.map((p, i) => ({ playerId: p.id, name: p.name, hasAnswered: pollClosed || i < 3 })),
    options: ['Pizza', 'Burger'].map((label, i) => {
      const voters = pollVoters.filter((_person, voter) => i === (voter === 1 ? 1 : 0));
      return { id: ['tour-pizza', 'tour-burger'][i], label, active: true, position: i,
        description: '', payload: {}, isRecommended: pollClosed && i === 0,
        counts: { can: voters.length, cannot: pollVoters.length - voters.length, ifNeeded: 0, open: players.length - pollVoters.length },
        people: { can: voters.map((p) => ({ playerId: p.id, name: p.name })), ifNeeded: [], cannot: [], ratings: {} } };
    }),
  };
  const ownRide = step === 'edit';
  const joined = step === 'join';
  const carpool = { id: 'tour-car', label: 'Auto Sam', direction: 'arrival', driverId: ownRide ? me.id : players[1].id,
    startLocation: 'Hamburg', startAt: start - 7_200_000, etaAt: start, seatsTotal: 3, seatsFree: joined ? 2 : 3,
    members: [ownRide ? me : players[1], ...(joined ? [me] : [])] };
  const task = { id: 'tour-task', type: 'item_request', title: 'Mehrfachsteckdosen', description: 'Mindestens 6 Steckplätze',
    status: step === 'done' ? 'done' : step === 'release' ? 'taken' : 'open',
    dueAt: step === 'due' ? now - 86_400_000 : start, createdAt: now, createdBy: me, assignees: ['release', 'done'].includes(step) ? [{ ...me, comment: 'Ich bringe zwei mit' }] : [],
    doneAt: step === 'done' ? now : null, archivedAt: null };
  const order = { id: 'tour-order', title: 'Pizza bei Luigi', createdBy: me.id, createdByName: me.name, createdAt: now,
    open: (chapter === 'organise' && step !== 'reopen') || (chapter === 'order' && step !== 'freeze'),
    closedAt: now - 10_800_000, finalizedAt: ['close', 'reopen'].includes(step) ? now : null, sendAt: start, notes: 'Bitte rechtzeitig eintragen',
    link: 'https://example.invalid/speisekarte', paypalLink: 'https://paypal.me/beispiel', tipPercent: 10,
    items: players.slice(0, 2).map((p, i) => ({ id: `tour-item-${i}`, playerId: p.id, playerName: p.name,
      description: i ? 'Pizza Funghi' : 'Pizza Margherita', quantity: i ? 1 : 2, priceCents: i ? 900 : 800,
      paid: i === 1 || step === 'close', createdAt: now })),
  };
  const draw = { id: 'tour-draw', gameId: games[0].id, gameName: games[0].name, gameIcon: '', generatedAt: now,
    source: 'draw', matchId: null, tournamentId: null, winnerTeamIndex: null,
    teams: [[players[0], players[2]], [players[1], players[3]]].map((team, i) => ({ name: `Team ${i + 1}`, skillSnapshot: true,
      players: team.map((p) => ({ ...p, skill: skills.find((s) => s.player_id === p.id).rating })), totalSkill: 6 })),
  };
  const state = { players, games, preferences, skills, activeEvent, events: [activeEvent], availableEvents: [activeEvent], historicalEvents: [activeEvent],
    live: [], matches: [], selectedGameId: games[0].id,
    lastMatchmaking: view === 'matchmaking' && (['teams', 'next', 'result', 'snapshot'].includes(step) || chapter === 'tournament-setup') ? draw : null,
    votes: { ...round, open: !finished, openRounds: finished ? [] : [round], catalogResults: results },
  };
  const responses = {
    '/api/groups': [{ id: 'tour-group', name: 'Beispielgruppe', role: admin ? 'owner' : 'member' }],
    '/api/skills/suggestions': { suggestions: [{ gameId: games[0].id, playerId: me.id, rating: 4, matchCount: 6, gamesPlayed: 6, wins: 4 }] },
    '/api/votes/history': { history: finished ? [history] : [] },
    '/api/votes/mine': { entries: submitted ? games.map((g, i) => ({ gameId: g.id, points: [4, 2, 0][i] })) : [] },
    '/api/events/tour-event/polls': [poll],
    '/api/checklist/tasks': { tasks: [task] },
    '/api/checklist/items': { items: [{ id: 'tour-cable', label: 'Netzwerkkabel', checked: false }, { id: 'tour-headset', label: 'Headset', checked: true }] },
    '/api/arrivals': { arrivals: players.map((p) => ({ player_id: p.id, player_name: p.name, arrival_at: step === 'leave' && p.id === me.id ? null : start, departure_at: start + 2 * 86_400_000, note: '' })), carpools: { arrival: [carpool], departure: [] } },
    '/api/food-orders': { orders: [order] },
    '/api/tournaments': [], '/api/draft': { draft: null },
    '/api/matchmaking/history': { history: [], openDraws: state.lastMatchmaking ? [draw] : [], nextCursor: null },
  };
  if (view === 'votes' && chapter === 'result' && step === 'limits') {
    history.anonymous = true;
    history.ballots = [];
  }
  if (view === 'votes' && chapter === 'result' && step === 'history') {
    responses['/api/votes/history'].history.push({ ...structuredClone(history), round: 0, title: 'Freitagabend', endedAt: now - 86_400_000 });
  }
  let open = '';
  let controls = [];
  let fill = {};
  let focus = '';
  if (view === 'votes' && chapter === 'result') focus = step === 'history' ? '[data-vote-history]' : '[data-latest-vote]';
  if (view === 'gameCatalog' && chapter === 'catalog') {
    if (['propose', 'platform', 'genres', 'notes', 'neighbors'].includes(step)) {
      open = '#suggest-new';
      fill = { '#suggest-title': 'Deep Rock Galactic', '#suggest-platform': 'Steam', '#suggest-info': 'Koop für vier Personen' };
      focus = ({ platform: '#suggest-platform-url', genres: '#suggest-genre-chips', notes: '#suggest-info', neighbors: '#suggest-consider-seat-neighbors' })[step] ?? '#suggest-title';
    } else { open = `[data-detail="${games[0].id}"]`; }
  }
  if (view === 'votes' && chapter === 'vote' && ['start', 'setup-info', 'setup-privacy', 'setup-games'].includes(step)) {
    open = '#votes-new'; fill = { '#votes-title': 'Samstagabend', '#votes-info': 'Was spielen wir als Nächstes?' };
    focus = ({ 'setup-info': '#votes-info', 'setup-privacy': '#votes-anonymous', 'setup-games': '#votes-game-select' })[step] ?? '#votes-title';
  }
  if (view === 'eventPolls' && chapter === 'manage' && ['start', 'mode', 'choices', 'privacy', 'deadline'].includes(step)) {
    open = '#new-event-poll'; fill = { '#poll-title': poll.title, '#poll-note': poll.note, '#poll-option-0': 'Pizza', '#poll-option-1': 'Burger' };
    controls = ['#poll-mode-search', '#poll-mode-results [data-search-select-value="single_choice"]'];
    focus = ({ mode: '#poll-mode', choices: '#poll-option-rows', privacy: '#poll-anonymous', deadline: '#poll-due' })[step] ?? '#poll-title';
  }
  if (view === 'eventPolls') {
    if (step === 'manual') focus = '[data-remind-poll]';
    if (chapter === 'manage' && step === 'options') open = '[data-edit-poll]';
    if (chapter === 'manage' && step === 'round') open = '[data-reopen-poll]';
    if (step === 'result') open = '[data-view-poll-votes]';
  }
  if (view === 'checklist' && ['create', 'title', 'deadline'].includes(step)) {
    open = '#checklist-new-todo-btn'; fill = { '#todo-title': task.title, '#todo-description': task.description };
    controls = ['[data-todo-kind="item_request"]'];
    focus = step === 'deadline' ? '#todo-due' : '#todo-title';
  }
  if (view === 'checklist' && step === 'claim') open = `[data-claim-task="${task.id}"]`;
  if (view === 'checklist' && step === 'done') open = `[data-task-detail="${task.id}"]`;
  if (view === 'arrivals' && ['offer', 'edit'].includes(step)) {
    open = step === 'offer' ? '[data-new-carpool="arrival"]' : '[data-edit-carpool]';
    fill = { '#carpool-label': 'Auto Sam', '#carpool-location': 'Hamburg' }; focus = '#carpool-seats';
  }
  if (view === 'foodOrders') {
    if (chapter === 'organise' && ['create', 'links', 'tip'].includes(step)) {
      open = '#order-new-btn'; fill = { '#order-title': order.title, '#order-notes': order.notes, '#order-tip': '10', '#order-paypal': order.paypalLink };
      focus = ({ links: '#order-paypal', tip: '#order-tip' })[step] ?? '#order-title';
    }
    if (step === 'edit') open = '[data-edit-details]';
    if (step === 'list') open = '[data-open-order-list]';
    if (step === 'send') open = '[data-close-order]';
    if (step === 'finalise') { order.open = false; open = '[data-finalize-order]'; }
    if (['paypal', 'confirm'].includes(step)) open = '[data-group-pay]';
    if (['item', 'quantity', 'price'].includes(step)) {
      fill = { '[data-add-item-form] [data-item-desc]': 'Pizza Margherita', '[data-add-item-form] [data-item-quantity]': '2', '[data-add-item-form] [data-item-price]': '8,00' };
      focus = '[data-add-item-form]';
    }
  }
  if (view === 'matchmaking') {
    if (chapter === 'tournament-setup') open = '[data-draw-tournament]';
    if (step === 'result') open = '[data-record-draw]';
    if (chapter === 'draft' && step === 'finish') state.lastMatchmaking = { ...draw, source: 'draft' };
    if (chapter === 'draft' && !['mode', 'roster', 'finish'].includes(step)) {
      responses['/api/draft'] = { draft: { id: 'tour-draft', status: 'active', gameId: games[0].id, gameName: games[0].name,
        turnCaptainId: me.id, turnCaptainIndex: 0, teams: [0, 1].map((i) => ({ captain: players[i], players: [players[i]] })), pool: players.slice(2) } };
      focus = '.draft-pool-player';
      if (step === 'cancel') open = '#draft-cancel';
    }
  }
  const voteSelection = view === 'votes' && chapter === 'result' && ['match', 'players'].includes(step)
    ? { gameId: games[0].id, playerIds: history.ballots.filter((ballot) => ballot.entries[0].points > 0).map((ballot) => ballot.playerId) } : null;
  return { view: voteSelection ? 'matchmaking' : view, me, state, responses, open, controls, fill, focus: voteSelection ? '#mm-game-search' : focus, stepId, voteSelection };
}

// No caller can turn this into a proxy. Even unknown GETs fail closed.
export function demoApiResponse(demo, input, options = {}) {
  const method = String(options.method ?? input?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') return { status: 405, body: { error: 'Diese Beispielansicht speichert keine Daten.' } };
  const url = new URL(typeof input === 'string' ? input : input.url, 'https://example.invalid');
  const body = demo.responses[url.pathname];
  return body === undefined ? { status: 404, body: { error: 'Für diesen Schritt ist kein Beispiel hinterlegt.' } } : { status: 200, body: structuredClone(body) };
}
