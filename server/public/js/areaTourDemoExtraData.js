// Additional examples use the normal API contracts and production renderers.
export function configureTourDemo(demo, { view, chapter, step, now, admin }) {
  const { state, responses, me } = demo;
  const { players, games, activeEvent } = state;
  const event = { ...activeEvent, name: 'Herbst-LAN', eventType: 'lan', location: 'Vereinshaus Hamburg',
    description: 'Drei Tage gemeinsam spielen', costCents: 3000, accommodationCostCents: 12000,
    paypalLink: 'https://paypal.me/beispiel', paymentDueAt: now + 86_400_000, publishedAt: now,
    createdBy: chapter === 'organise' ? me.id : players[1].id, canManagePayments: chapter === 'organise', isBase: false, isEnded: false, trackingEnabled: false,
    myParticipation: { status: 'accepted', paid: false, calendarConfirmed: false, canDecline: true, canAccept: false },
    participants: players.map((p, i) => ({ playerId: p.id, name: p.name, status: 'accepted', paid: i > 0,
      calendarConfirmed: i > 0, invitedAt: now, acceptedAt: now })) };
  const invite = { ...event, id: 'tour-invitation', name: 'Winter-LAN', startsAt: event.startsAt + 28 * 86_400_000,
    endsAt: event.endsAt + 28 * 86_400_000, participants: [], myParticipation: { status: 'invited', paid: false, canAccept: true, canDecline: true } };
  const group = { ...event, id: 'tour-permanent-group', name: 'Freitagsrunde', eventType: 'group',
    startsAt: null, endsAt: null, costCents: 0, accommodationCostCents: 0, paypalLink: null };
  const notification = { id: 'tour-notification', title: 'Deine Bestellung ist abgeschickt',
    body: 'Für deine zwei Pizzen sind noch 17,60 € offen.', url: '/#foodOrders', type: 'food-order-payment',
    audience: 'direct', eventId: event.id, eventName: event.name, createdAt: now - 60_000,
    seen: false, resolvedAt: null, expiresAt: null };
  responses['/api/push/log'] = { entries: [notification, { ...notification, id: 'tour-notification-old',
    title: 'Mehrfachsteckdosen übernommen', body: 'Die Aufgabe wurde erledigt.', seen: true, resolvedAt: now - 30_000 }] };
  responses['/api/push/current'] = { entry: null };
  responses['/api/info'] = { entries: [{ id: 'tour-wlan', title: 'WLAN', content: 'Netz: Respawn · Passwort: GemeinsamSpielen', updatedAt: now },
    { id: 'tour-discord', title: 'Discord', content: 'Sprachkanal: LAN-Lobby', updatedAt: now }] };
  responses['/api/broadcasts'] = { broadcasts: [{ id: 'tour-broadcast', playerId: me.id, playerName: me.name,
    message: 'Das Abendessen steht ab 19 Uhr in der Küche bereit.', createdAt: now - 60_000, endsAt: now + 3_600_000, endedAt: null }] };
  if (view === 'home' || view === 'events') {
    state.activeEvent = event;
    state.events = [event, invite, group];
    state.availableEvents = [event, group];
    state.historicalEvents = [event, group];
    state.eventInvitations = [invite];
    state.plannedEvents = [];
    state.endedEvents = [];
    state.declinedEvents = [];
    state.managedEvents = admin ? [event, invite, group] : null;
    responses['/api/events/tour-event'] = event;
  }
  if (view === 'home') {
    state.live = players.map((p, i) => ({ ...p, player_id: p.id, state: ['playing', 'online', 'paused', 'offline'][i],
      note: i === 2 ? 'Pause' : null, games: i === 0 ? [{ game_id: games[0].id, game_name: games[0].name, since: now - 1_800_000 }] : [] }));
    responses['/api/arcade/lobbies'] = { lobbies: [] };
    responses['/api/digest'] = { missingSkills: [] };
    responses['/api/seating/layout'] = { layout: { topSeats: 0, rightSeats: 0, bottomSeats: 0, leftSeats: 0 }, players: [] };
    responses['/api/me/todos'] = { pendingVoteRounds: [2], todos: [
      { id: 'tour-todo-payment', kind: 'food-payment', audience: 'personal', eventId: event.id, eventName: event.name,
        orderId: 'tour-order', orderTitle: 'Pizza bei Luigi', unpaidCount: 1 },
      { id: 'tour-todo-task', kind: 'task', audience: 'personal', eventId: invite.id, eventName: invite.name,
        taskId: 'tour-task', title: 'Mehrfachsteckdosen mitbringen', dueAt: now + 86_400_000 },
    ] };
    if (step === 'event') state.activeEvent = { ...event, eventType: 'general' };
    if (step === 'other-event') demo.focus = '[data-home-todo="tour-todo-task"]';
    if (chapter === 'context' && ['workspace', 'account', 'types', 'shared'].includes(step)) {
      demo.controls = ['#demo-event-search']; demo.focus = '#demo-event-list';
    }
    if (chapter === 'context' && step === 'info') { demo.open = '#info-btn'; demo.focus = ''; }
    if (chapter === 'context' && step === 'search') {
      demo.open = '#global-search-btn'; demo.fill = { '#global-search-input': 'Rocket' }; demo.focus = '#global-search-results';
    }
    if (chapter === 'notifications') { demo.controls = ['#notifications-btn']; demo.focus = '#notifications-panel'; }
  }
  if (view === 'events') {
    if (chapter === 'participate' && ['invitation', 'accept'].includes(step)) {
      demo.focus = '[data-pending-invitation]';
    } else if (chapter === 'participate') demo.focus = '[data-event-card="tour-event"]';
    if (step === 'create') { demo.open = '#new-event-btn'; demo.fill = { '#event-name': 'Sommer-LAN' }; demo.focus = '#event-name'; }
    if (['calendar', 'confirm'].includes(step)) {
      demo.controls = ['[data-action-menu="event-calendar-tour-event"] > summary'];
      demo.focus = '[data-action-menu="event-calendar-tour-event"]';
    }
    if (step === 'confirm') demo.focus = '[data-confirm-event-calendar="tour-event"]';
    if (step === 'payment') demo.open = '[data-pay-event="tour-event"]';
    if (step === 'decline') {
      demo.controls = ['[data-action-menu="event-decline-tour-event"] > summary'];
      demo.focus = '[data-action-menu="event-decline-tour-event"]';
    }
    if (step === 'excuse') demo.open = '[data-decline-with-excuse="tour-event"]';
  }
  if (view === 'broadcast') {
    demo.fill = { '#broadcast-message': 'Das Abendessen steht ab 19 Uhr in der Küche bereit.' };
    demo.focus = '#broadcast-form';
  }
  if (view === 'tournaments' || (view === 'matchmaking' && chapter === 'tournament-play')) {
    demo.view = 'tournaments';
    demo.localRoute = { kind: 'detail', id: 'tour-tournament' };
    const afterResult = ['effects', 'correction', 'complete'].includes(step);
    const completed = step === 'complete';
    const teams = players.map((p, i) => ({ id: `tour-team-${i}`, name: ['Nord', 'Süd', 'Ost', 'West'][i], players: [p] }));
    const match = (id, round, position, a, b, winner = null) => ({ id, round, slot: position, teamAId: a, teamBId: b,
      winnerTeamId: winner, isDraw: false, isBye: false, scoreA: winner ? 2 : null, scoreB: winner ? 1 : null,
      playedAt: winner ? now - 60_000 : null, matchId: winner ? `record-${id}` : null, lobbyName: `LAN-${round}-${position + 1}` });
    const detail = { id: 'tour-tournament', name: 'Rocket-League-Cup', gameId: games[0].id, gameName: games[0].name,
      format: 'single_elimination', status: completed ? 'completed' : 'active', createdBy: me.id, createdAt: now,
      teams, trackScore: true, twoLegged: false, thirdPlaceMatch: false, endedEarly: false,
      lobbyBaseName: 'LAN', lobbyPassword: 'Gemeinsam', championTeamId: completed ? teams[0].id : null,
      standings: [], placements: [], matches: [
        match('tour-semi-1', 1, 0, teams[0].id, teams[1].id, afterResult ? teams[0].id : null),
        match('tour-semi-2', 1, 1, teams[2].id, teams[3].id, teams[2].id),
        match('tour-final', 2, 0, afterResult ? teams[0].id : null, teams[2].id, completed ? teams[0].id : null),
      ] };
    responses['/api/tournaments/tour-tournament'] = detail;
    demo.open = ['result', 'correction'].includes(step) ? '[data-open-result="tour-semi-1"]' : '';
    demo.focus = ({ team: '[data-tournament-teams]', lobbies: '#tournament-lobbies-title',
      effects: '.tournament-bracket', complete: '[data-tournament-champion]' })[step] ?? '';
    if (step === 'early') demo.open = '#tourn-finish';
    if (step === 'delete') demo.open = '#tourn-delete';
  }
  if (view === 'music') {
    const track = { uri: 'spotify:track:tour-current', name: 'LAN-Nacht', artist: 'Die Pixel', durationMs: 210_000, imageUrl: null };
    const request = (id, name, artist, p, status = 'queued') => ({ id, trackUri: `spotify:track:${id}`, name, artist,
      requestedBy: p.id, requestedByName: p.name, durationMs: 180_000, imageUrl: null, status });
    const controller = { id: 'tour-controller', label: 'Musik-PC', online: true, spotifyDisplayName: 'Alex',
      connectionStatus: { spotify: 'connected' } };
    const session = { id: 'tour-jam', hostPlayerId: me.id, hostPlayerName: me.name, deviceName: 'Lautsprecher im Saal',
      isPlaying: false, progressMs: 65_000, playbackUpdatedAt: now, currentTrack: track, playbackContext: null,
      requests: [{ ...request('tour-current', track.name, track.artist, players[1], 'playing'), trackUri: track.uri },
        request('tour-next', 'Noch eine Runde', 'Pixelband', me), request('tour-last', 'Gute Nacht, Lobby', 'Jo & Co.', players[2])] };
    const status = { controller, session: chapter === 'setup' ? null : session, canManageController: admin, warning: null };
    if (chapter === 'setup' && ['controller', 'pair', 'spotify'].includes(step)) {
      controller.online = false;
      if (step === 'controller') status.controller = null;
    }
    if (step === 'recover') controller.connectionStatus = { spotify: 'authorization_required' };
    responses['/api/music/status'] = status;
    responses['/web-player/status'] = { available: false };
    responses['/api/music/devices'] = { devices: [{ id: 'tour-speaker', name: 'Lautsprecher im Saal', type: 'Speaker', active: true }] };
    responses['/api/music/search'] = { tracks: [{ ...track, id: 'tour-result', uri: 'spotify:track:tour-result', name: 'Nächste Runde' }],
      playlists: [{ id: 'tour-playlist', name: 'LAN-Abend', owner: 'Alex', imageUrl: null, trackCount: 12 }] };
    if (step === 'add' || step === 'playlist') {
      demo.fill = { '#music-search-input': step === 'playlist' ? 'LAN-Abend' : 'Nächste Runde' };
      demo.submit = '#music-search-form'; demo.focus = '#music-search-results';
    }
    if (step === 'queue') { demo.open = '[data-music-detail="tour-next"]'; demo.focus = ''; }
    if (step === 'playlist') demo.afterSubmitOpen = '[data-music-playlist="tour-playlist"]';
    if (step === 'device') demo.focus = '#music-device-area';
  }
  if (view === 'arcade') {
    const lobby = { id: 'tour-pong-lobby', mode: 'doubles', host: players[1], playerLimit: 4,
      players: players.filter((p) => step === 'ready' || p.id !== me.id).map((p, i) => ({ ...p,
        team: p.id === me.id || p.id === players[1].id ? 'left' : 'right', ready: i > 0 && p.id !== me.id })),
      createdAt: now, targetScore: 21 };
    demo.socketSnapshots = { 'pong:lobbies': { lobbies: [lobby] },
      'arcade:watch:list': { matches: [{ matchId: 'tour-pong-match', gameType: 'pong', players: players.slice(2),
        scores: players.slice(2).map((p, i) => ({ playerId: p.id, name: p.name, score: 3 - i })), paused: false }] } };
    responses['/api/arcade/stats'] = { games: [{ gameType: 'pong', matches: 6,
      players: players.map((p, i) => ({ playerId: p.id, name: p.name, wins: [3, 2, 1, 0][i], matches: 6 })) }] };
    if (step === 'open') {
      demo.open = '#arcade-create-lobby';
      demo.controls = [{ selector: '#arcade-create-game', value: 'pong' }, '#arcade-create-mode [data-arcade-mode="doubles"]'];
    }
    if (step === 'ready') demo.focus = '[data-ready]';
    if (step === 'join') demo.focus = '[data-pong-join]:not([disabled])';
    if (step === 'watch') demo.focus = '[data-watch-match]';
  }
  return demo;
}
