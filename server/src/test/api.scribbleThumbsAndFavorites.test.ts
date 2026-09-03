// Integration tests for Scribble's live "thumbs up" (ephemeral, per-drawing
// vote used only to sort the round-end gallery), reconnect state and the
// post-match "pick a favorite from every drawing" step - plus the 3+ player
// leave case that used to leave the game open for the player who left (no
// scribble:match:end broadcast fires when enough players remain online).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp, installTestSocketIdentity } from './testApp';
import { registerScribbleSockets, clearScribbleState } from '../arcade/scribble';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';
import { db } from '../db';

function connect(baseUrl: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitAck(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForEvent(socket: ClientSocket, event: string): Promise<any> {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function makePlayers(baseUrl: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const res = await request(baseUrl).post('/api/players').send({ name });
    assert.equal(res.status, 201);
    ids.push(res.body.id);
  }
  return ids;
}

// Starts a 2-player match on hostSocket/guestSocket and drives it to the
// first drawing phase (host draws). Returns the matchId and the token for
// the drawing currently in progress.
async function startMatchAndBeginDrawing(
  hostSocket: ClientSocket,
  guestSocket: ClientSocket,
  hostId: string,
  guestId: string,
): Promise<{ matchId: string; token: string }> {
  const created = await emitAck(hostSocket, 'scribble:lobby:create', { playerId: hostId });
  await emitAck(guestSocket, 'scribble:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
  const startPromise = waitForEvent(guestSocket, 'scribble:match:start') as Promise<{ matchId: string }>;
  await emitAck(hostSocket, 'scribble:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
  const { matchId } = await startPromise;

  const choosePromise = waitForEvent(hostSocket, 'scribble:choose') as Promise<{ options: Array<{ id: string }> }>;
  const drawingTurnPromise = new Promise<{ phase: string; thumbsToken: string }>((resolve) => {
    const onTurn = (payload: { phase: string; thumbsToken: string }) => {
      if (payload.phase !== 'drawing') return;
      guestSocket.off('scribble:turn', onTurn);
      resolve(payload);
    };
    guestSocket.on('scribble:turn', onTurn);
  });
  const { options } = await choosePromise;
  await emitAck(hostSocket, 'scribble:word', { matchId, playerId: hostId, wordId: options[0].id });
  const turn = await drawingTurnPromise;
  assert.equal(turn.phase, 'drawing');
  return { matchId, token: turn.thumbsToken };
}

test('Scribble live thumbs-up: toggles, rejects the artist and stale tokens, never touches reactions', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerScribbleSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const hostSocket = await connect(baseUrl);
  const guestSocket = await connect(baseUrl);
  try {
    const [hostId, guestId] = await makePlayers(baseUrl, ['Thumb Host', 'Thumb Guest']);
    const { matchId, token } = await startMatchAndBeginDrawing(hostSocket, guestSocket, hostId, guestId);
    assert.ok(token, 'a drawing phase opens a live thumbs token');

    // The drawer can't thumb their own (in-progress) drawing.
    const ownAttempt = await emitAck(hostSocket, 'scribble:thumb', { matchId, playerId: hostId, token });
    assert.equal(ownAttempt.ok, false);

    // A guesser can toggle it on, then off.
    const updatePromise = waitForEvent(hostSocket, 'scribble:thumb-update');
    const on = await emitAck(guestSocket, 'scribble:thumb', { matchId, playerId: guestId, token });
    assert.equal(on.ok, true);
    assert.equal(on.active, true);
    assert.equal(on.count, 1);
    const update = await updatePromise;
    assert.equal(update.count, 1);

    const off = await emitAck(guestSocket, 'scribble:thumb', { matchId, playerId: guestId, token });
    assert.equal(off.ok, true);
    assert.equal(off.active, false);
    assert.equal(off.count, 0);

    // A stale/unknown token (e.g. from a previous drawing) is rejected.
    const stale = await emitAck(guestSocket, 'scribble:thumb', {
      matchId,
      playerId: guestId,
      token: 'not-the-current-token',
    });
    assert.equal(stale.ok, false);

    // The thumb never touches the persisted reactions table - it's purely
    // an in-memory pre-selection/sort signal.
    const reactionRows = db.prepare('SELECT COUNT(*) AS n FROM scribble_drawing_reactions').get() as { n: number };
    assert.equal(reactionRows.n, 0);
  } finally {
    hostSocket.close();
    guestSocket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearScribbleState();
  }
});

test('Scribble rejoin restores the live drawing and thumb vote, then exposes a blank next turn', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerScribbleSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const hostSocket = await connect(baseUrl);
  const guestSocket = await connect(baseUrl);
  const thirdSocket = await connect(baseUrl);
  let rejoinedSocket: ClientSocket | null = null;
  try {
    const [hostId, guestId, thirdId] = await makePlayers(baseUrl, ['Rejoin Host', 'Rejoin Guest', 'Rejoin Third']);
    const created = await emitAck(hostSocket, 'scribble:lobby:create', { playerId: hostId });
    await emitAck(guestSocket, 'scribble:lobby:join', {
      lobbyId: created.lobbyId,
      playerId: guestId,
    });
    await emitAck(thirdSocket, 'scribble:lobby:join', {
      lobbyId: created.lobbyId,
      playerId: thirdId,
    });

    const startPromise = waitForEvent(guestSocket, 'scribble:match:start') as Promise<{
      matchId: string;
    }>;
    await emitAck(hostSocket, 'scribble:lobby:start', {
      lobbyId: created.lobbyId,
      playerId: hostId,
      rounds: 2,
    });
    const { matchId } = await startPromise;

    const choosePromise = waitForEvent(hostSocket, 'scribble:choose') as Promise<{
      options: Array<{ id: string; word: string }>;
    }>;
    const drawingTurnPromise = new Promise<{ phase: string; thumbsToken: string }>((resolve) => {
      const onTurn = (payload: { phase: string; thumbsToken: string }) => {
        if (payload.phase !== 'drawing') return;
        thirdSocket.off('scribble:turn', onTurn);
        resolve(payload);
      };
      thirdSocket.on('scribble:turn', onTurn);
    });
    const { options } = await choosePromise;
    const selectedWord = options[0];
    await emitAck(hostSocket, 'scribble:word', {
      matchId,
      playerId: hostId,
      wordId: selectedWord.id,
    });
    const drawingTurn = await drawingTurnPromise;

    const stroke = {
      strokeId: 'rejoin-stroke',
      color: '#123456',
      size: 5,
      erase: false,
      points: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    };
    const strokeAck = await emitAck(hostSocket, 'scribble:stroke', {
      matchId,
      playerId: hostId,
      ...stroke,
    });
    assert.equal(strokeAck.ok, true);
    const thumbAck = await emitAck(guestSocket, 'scribble:thumb', {
      matchId,
      playerId: guestId,
      token: drawingTurn.thumbsToken,
    });
    assert.equal(thumbAck.ok, true);
    assert.equal(thumbAck.active, true);

    // This closes the transport for real. The former browser test's 600 ms
    // offline window was shorter than Socket.IO's heartbeat and therefore did
    // not reliably enter the server's disconnect/rejoin path.
    const offlinePresence = new Promise<void>((resolve) => {
      const onPresence = (payload: { playerId: string; online: boolean }) => {
        if (payload.playerId !== guestId || payload.online) return;
        hostSocket.off('scribble:presence', onPresence);
        resolve();
      };
      hostSocket.on('scribble:presence', onPresence);
    });
    guestSocket.close();
    await offlinePresence;

    rejoinedSocket = await connect(baseUrl);
    const onlinePresence = new Promise<void>((resolve) => {
      const onPresence = (payload: { playerId: string; online: boolean }) => {
        if (payload.playerId !== guestId || !payload.online) return;
        hostSocket.off('scribble:presence', onPresence);
        resolve();
      };
      hostSocket.on('scribble:presence', onPresence);
    });
    const rejoin = await emitAck(rejoinedSocket, 'scribble:rejoin', {
      matchId,
      playerId: guestId,
    });
    await onlinePresence;
    assert.equal(rejoin.ok, true);
    const drawingSync = rejoin.sync as {
      phase: string;
      strokes: Array<{ strokeId: string; points: number[][] }>;
      thumbsToken: string;
      thumbsCount: number;
      myThumbActive: boolean;
      hasGuessedCorrectly: boolean;
    };
    assert.equal(drawingSync.phase, 'drawing');
    assert.deepEqual(drawingSync.strokes, [{ type: 'stroke', ...stroke }]);
    assert.equal(drawingSync.thumbsToken, drawingTurn.thumbsToken);
    assert.equal(drawingSync.thumbsCount, 1);
    assert.equal(drawingSync.myThumbActive, true);
    assert.equal(drawingSync.hasGuessedCorrectly, false, 'the guest has not guessed yet at this point');

    // The replacement socket must own the restored vote, not merely receive
    // a cosmetically correct snapshot.
    const toggledOff = await emitAck(rejoinedSocket, 'scribble:thumb', {
      matchId,
      playerId: guestId,
      token: drawingTurn.thumbsToken,
    });
    assert.equal(toggledOff.ok, true);
    assert.equal(toggledOff.active, false);
    const toggledOn = await emitAck(rejoinedSocket, 'scribble:thumb', {
      matchId,
      playerId: guestId,
      token: drawingTurn.thumbsToken,
    });
    assert.equal(toggledOn.ok, true);
    assert.equal(toggledOn.active, true);

    const nextChoicePromise = waitForEvent(rejoinedSocket, 'scribble:choose');
    const guestGuess = await emitAck(rejoinedSocket, 'scribble:guess', {
      matchId,
      playerId: guestId,
      text: selectedWord.word,
    });
    assert.equal(guestGuess.correct, true);

    // A guess whose acknowledgement never reaches the client (a further
    // disconnect right after the correct guess was recorded) must still be
    // recoverable on the next rejoin instead of leaving the client's UI
    // stuck on "pending" forever - the turn has not ended yet since the
    // third player has not guessed, so this checks the mid-turn record.
    const midTurnRejoin = await emitAck(rejoinedSocket, 'scribble:rejoin', {
      matchId,
      playerId: guestId,
    });
    assert.equal(midTurnRejoin.ok, true);
    const midTurnSync = midTurnRejoin.sync as { phase: string; hasGuessedCorrectly: boolean };
    assert.equal(midTurnSync.phase, 'drawing', 'the turn has not ended yet - the third player has not guessed');
    assert.equal(midTurnSync.hasGuessedCorrectly, true);

    const thirdGuess = await emitAck(thirdSocket, 'scribble:guess', {
      matchId,
      playerId: thirdId,
      text: selectedWord.word,
    });
    assert.equal(thirdGuess.correct, true);
    await nextChoicePromise;

    const choosingRejoin = await emitAck(rejoinedSocket, 'scribble:rejoin', {
      matchId,
      playerId: guestId,
    });
    assert.equal(choosingRejoin.ok, true);
    const choosingSync = choosingRejoin.sync as {
      phase: string;
      strokes: unknown[];
      wordOptions: Array<{ id: string; word: string }> | null;
    };
    assert.equal(choosingSync.phase, 'choosing');
    assert.deepEqual(choosingSync.strokes, []);
    assert.ok(choosingSync.wordOptions?.length, 'the rejoined next drawer receives private choices');

    const finished = await emitAck(hostSocket, 'scribble:match:finish', {
      matchId,
      playerId: hostId,
    });
    assert.equal(finished.ok, true);
  } finally {
    hostSocket.close();
    guestSocket.close();
    thirdSocket.close();
    rejoinedSocket?.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearScribbleState();
  }
});

test('Scribble keeps a two-player match alive during the reconnect grace period and coalesces stream snapshots', async () => {
  clearLobbyMemberships();
  const previousGrace = process.env.SCRIBBLE_RECONNECT_GRACE_MS;
  process.env.SCRIBBLE_RECONNECT_GRACE_MS = '250';
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerScribbleSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const hostSocket = await connect(baseUrl);
  const guestSocket = await connect(baseUrl);
  let rejoinedSocket: ClientSocket | null = null;
  try {
    const [hostId, guestId] = await makePlayers(baseUrl, ['Grace Host', 'Grace Guest']);
    const { matchId } = await startMatchAndBeginDrawing(hostSocket, guestSocket, hostId, guestId);

    let streamSnapshots = 0;
    hostSocket.on('arcade:kiosk:game', (payload: { gameType?: string; matchId?: string; strokes?: unknown[] }) => {
      if (payload.gameType === 'scribble' && payload.matchId === matchId && payload.strokes?.length) streamSnapshots += 1;
    });
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        emitAck(hostSocket, 'scribble:stroke', {
          matchId,
          playerId: hostId,
          strokeId: `coalesced-${index}`,
          color: '#123456',
          size: 5,
          erase: false,
          points: [[index / 20, index / 20]],
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(streamSnapshots, 1, 'a rapid stroke burst should produce one full spectator snapshot');

    let ended = false;
    hostSocket.once('scribble:match:end', () => {
      ended = true;
    });
    const offlinePresence = new Promise<void>((resolve) => {
      const onPresence = (payload: { playerId: string; online: boolean }) => {
        if (payload.playerId !== guestId || payload.online) return;
        hostSocket.off('scribble:presence', onPresence);
        resolve();
      };
      hostSocket.on('scribble:presence', onPresence);
    });
    guestSocket.close();
    await offlinePresence;
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(ended, false, 'a transient disconnect must not end a two-player match immediately');

    rejoinedSocket = await connect(baseUrl);
    const onlinePresence = new Promise<void>((resolve) => {
      const onPresence = (payload: { playerId: string; online: boolean }) => {
        if (payload.playerId !== guestId || !payload.online) return;
        hostSocket.off('scribble:presence', onPresence);
        resolve();
      };
      hostSocket.on('scribble:presence', onPresence);
    });
    const rejoin = await emitAck(rejoinedSocket, 'scribble:rejoin', { matchId, playerId: guestId });
    await onlinePresence;
    assert.equal(rejoin.ok, true);
    assert.equal((rejoin.sync as { phase?: string }).phase, 'drawing');
    await new Promise((resolve) => setTimeout(resolve, 225));
    assert.equal(ended, false, 'the cancelled grace timer must not end the restored match later');

    const finished = await emitAck(hostSocket, 'scribble:match:finish', { matchId, playerId: hostId });
    assert.equal(finished.ok, true);
  } finally {
    hostSocket.close();
    guestSocket.close();
    rejoinedSocket?.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearScribbleState();
    if (previousGrace === undefined) delete process.env.SCRIBBLE_RECONNECT_GRACE_MS;
    else process.env.SCRIBBLE_RECONNECT_GRACE_MS = previousGrace;
  }
});

// Once the grace period expires, a 2-player match is deleted and rejoin must
// fail cleanly. The client uses this response to clear any guess whose socket
// acknowledgement was lost and return to the Arcade launcher.
test('Scribble rejoin cannot recover a two-player match after the reconnect grace expires', async () => {
  clearLobbyMemberships();
  const previousGrace = process.env.SCRIBBLE_RECONNECT_GRACE_MS;
  process.env.SCRIBBLE_RECONNECT_GRACE_MS = '40';
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerScribbleSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const hostSocket = await connect(baseUrl);
  const guestSocket = await connect(baseUrl);
  let rejoinedSocket: ClientSocket | null = null;
  try {
    const [hostId, guestId] = await makePlayers(baseUrl, ['Expired Host', 'Expired Guest']);
    const { matchId } = await startMatchAndBeginDrawing(hostSocket, guestSocket, hostId, guestId);

    const matchEndPromise = waitForEvent(hostSocket, 'scribble:match:end');
    guestSocket.close();
    await matchEndPromise;

    rejoinedSocket = await connect(baseUrl);
    const rejoin = await emitAck(rejoinedSocket, 'scribble:rejoin', { matchId, playerId: guestId });
    assert.equal(rejoin.ok, false, 'the match no longer exists after the reconnect grace expires');
  } finally {
    hostSocket.close();
    guestSocket.close();
    rejoinedSocket?.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearScribbleState();
    if (previousGrace === undefined) delete process.env.SCRIBBLE_RECONNECT_GRACE_MS;
    else process.env.SCRIBBLE_RECONNECT_GRACE_MS = previousGrace;
  }
});

test('Scribble final favorite: pickable once the match ends, spans every drawing, rejects a lone artist voting for themself', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerScribbleSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const hostSocket = await connect(baseUrl);
  const guestSocket = await connect(baseUrl);
  try {
    const [hostId, guestId] = await makePlayers(baseUrl, ['Favorite Host', 'Favorite Guest']);
    const created = await emitAck(hostSocket, 'scribble:lobby:create', { playerId: hostId });
    await emitAck(guestSocket, 'scribble:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
    const startPromise = waitForEvent(guestSocket, 'scribble:match:start') as Promise<{ matchId: string }>;
    await emitAck(hostSocket, 'scribble:lobby:start', { lobbyId: created.lobbyId, playerId: hostId, rounds: 1 });
    const { matchId } = await startPromise;

    // Drive the match to a real end (2 players, guest leaves = match over)
    // without waiting out the real turn/gallery timers - the final-favorite
    // handler itself is match-agnostic (DB-only), so seed the two drawings
    // it needs to rate directly, exactly as persistCurrentDrawing would have.
    const choosePromise = waitForEvent(hostSocket, 'scribble:choose') as Promise<{ options: Array<{ id: string }> }>;
    const { options } = await choosePromise;
    await emitAck(hostSocket, 'scribble:word', { matchId, playerId: hostId, wordId: options[0].id });
    const endPromise = waitForEvent(hostSocket, 'scribble:match:end');
    await emitAck(guestSocket, 'scribble:match:leave', { matchId, playerId: guestId });
    await endPromise;

    const hostDrawingId = 'test-drawing-host';
    const guestDrawingId = 'test-drawing-guest';
    const insert = db.prepare(
      `INSERT INTO scribble_drawings (id, match_id, round_number, turn_number, artist_id, artist_name, word, draw_ops, created_at)
       VALUES (?, ?, 1, ?, ?, ?, 'Wort', '[]', ?)`,
    );
    insert.run(hostDrawingId, matchId, 1, hostId, 'Favorite Host', Date.now());
    insert.run(guestDrawingId, matchId, 2, guestId, 'Favorite Guest', Date.now());

    // The guest can favorite the host's drawing (a different artist exists).
    const vote = await emitAck(hostSocket, 'scribble:match:favorite-final', {
      matchId,
      playerId: guestId,
      drawingId: hostDrawingId,
    });
    assert.equal(vote.ok, true);
    assert.equal(vote.drawingId, hostDrawingId);
    const row = db
      .prepare(
        'SELECT drawing_id FROM scribble_drawing_favorites WHERE match_id = ? AND round_number = 0 AND player_id = ?',
      )
      .get(matchId, guestId) as { drawing_id: string } | undefined;
    assert.equal(row?.drawing_id, hostDrawingId, 'the final favorite persists under the round_number=0 sentinel');

    // Changing the pick to their own drawing is rejected while another
    // artist's drawing exists in the match.
    const ownVote = await emitAck(hostSocket, 'scribble:match:favorite-final', {
      matchId,
      playerId: guestId,
      drawingId: guestDrawingId,
    });
    assert.equal(ownVote.ok, false);

    // A drawing id from a foreign match is rejected.
    const bogus = await emitAck(hostSocket, 'scribble:match:favorite-final', {
      matchId,
      playerId: hostId,
      drawingId: 'does-not-exist',
    });
    assert.equal(bogus.ok, false);
  } finally {
    hostSocket.close();
    guestSocket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearScribbleState();
  }
});

test('Scribble leave with 3+ remaining players: the match keeps running for the others (no match:end reaches them)', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerScribbleSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const hostSocket = await connect(baseUrl);
  const guestSocket = await connect(baseUrl);
  const thirdSocket = await connect(baseUrl);
  try {
    const [hostId, guestId, thirdId] = await makePlayers(baseUrl, ['Trio Host', 'Trio Guest', 'Trio Third']);
    const created = await emitAck(hostSocket, 'scribble:lobby:create', { playerId: hostId });
    await emitAck(guestSocket, 'scribble:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
    await emitAck(thirdSocket, 'scribble:lobby:join', { lobbyId: created.lobbyId, playerId: thirdId });
    const startPromise = waitForEvent(guestSocket, 'scribble:match:start') as Promise<{ matchId: string }>;
    await emitAck(hostSocket, 'scribble:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
    const { matchId } = await startPromise;

    // With 3 players still online after one leaves, the match must not end -
    // this is the server-side precondition the frontend leave fix relies on
    // (it can no longer wait for a scribble:match:end that will never come).
    let sawMatchEnd = false;
    hostSocket.once('scribble:match:end', () => {
      sawMatchEnd = true;
    });
    const left = await emitAck(thirdSocket, 'scribble:match:leave', { matchId, playerId: thirdId });
    assert.equal(left.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(sawMatchEnd, false, 'the match keeps running for the two remaining players');
  } finally {
    hostSocket.close();
    guestSocket.close();
    thirdSocket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearScribbleState();
  }
});
