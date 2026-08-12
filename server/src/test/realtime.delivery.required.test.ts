// Required delivery matrix for the event-workspace model. Every normal
// socket and every kiosk has exactly one concrete event scope; delivery
// revalidates membership, participation and token state immediately.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { nanoid } from 'nanoid';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from '../db';
import {
  broadcast,
  createSocketAuthGuard,
  Events,
  registerScopedSockets,
  setIo,
  switchPlayerEventScope,
} from '../realtime';
import { registerArcadeSockets } from '../arcade/realtime';
import { issueKioskToken, revokeKioskToken } from '../kioskTokens';
import { createSession, SESSION_COOKIE_NAME } from '../sessions';
import { ensureAccountEventContext, fallbackPlayerEventContext, setActiveEventForPlayer } from '../eventContext';

interface TestServer {
  baseUrl: string;
}

function createPlayer(name: string): string {
  const id = nanoid();
  const now = Date.now();
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    `${name} ${id}`,
    nanoid(24),
    now,
  );
  db.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES (?, ?, 'member', 'active', ?, 0)`,
  ).run(DEFAULT_GROUP_ID, id, now);
  ensureAccountEventContext(id);
  return id;
}

function createEvent(name: string): string {
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope)
     VALUES (?, ?, ?, ?, 0, ?, 'published', 'participants')`,
  ).run(id, `${name} ${id}`, now - 1_000, now + 60_000, DEFAULT_GROUP_ID);
  return id;
}

function activate(playerId: string, eventId: string): void {
  db.prepare(
    `INSERT INTO event_participants (event_id, player_id, status)
     VALUES (?, ?, 'accepted')
     ON CONFLICT(event_id, player_id) DO UPDATE SET status = 'accepted'`,
  ).run(eventId, playerId);
  assert.ok(setActiveEventForPlayer(playerId, eventId));
}

async function withServer(fn: (server: TestServer) => Promise<void>): Promise<void> {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  io.use(createSocketAuthGuard());
  registerScopedSockets(io);
  registerArcadeSockets(io);
  setIo(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  try {
    await fn({ baseUrl });
  } finally {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    setIo(null);
  }
}

function connectSession(baseUrl: string, playerId: string): Promise<ClientSocket> {
  const token = createSession(playerId);
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function connectKiosk(baseUrl: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      auth: { kiosk: true, token },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

async function subscribe(socket: ClientSocket, eventId?: string): Promise<{ eventId: string }> {
  const result = await new Promise<{ ok: boolean; eventId?: string; error?: string }>((resolve) => {
    socket.emit('scope:subscribe', { groupId: DEFAULT_GROUP_ID, ...(eventId ? { eventId } : {}) }, resolve);
  });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.eventId);
  return { eventId: result.eventId };
}

function payloads(socket: ClientSocket, event: string): unknown[] {
  const values: unknown[] = [];
  socket.on(event, (payload: unknown) => values.push(payload));
  return values;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 75));

test('normal sockets default to the persisted active event and never receive another event', async () => {
  const alice = createPlayer('Event Alice');
  const bob = createPlayer('Event Bob');
  const eventA = createEvent('Event A');
  const eventB = createEvent('Event B');
  activate(alice, eventA);
  activate(bob, eventB);

  await withServer(async ({ baseUrl }) => {
    const aliceSocket = await connectSession(baseUrl, alice);
    const bobSocket = await connectSession(baseUrl, bob);
    try {
      assert.equal((await subscribe(aliceSocket)).eventId, eventA);
      assert.equal((await subscribe(bobSocket)).eventId, eventB);
      const aliceVotes = payloads(aliceSocket, Events.votesChanged);
      const bobVotes = payloads(bobSocket, Events.votesChanged);
      broadcast(Events.votesChanged, { event: 'A' }, { groupId: DEFAULT_GROUP_ID, eventId: eventA });
      await settle();
      assert.deepEqual(aliceVotes, [{ event: 'A' }]);
      assert.deepEqual(bobVotes, []);
    } finally {
      aliceSocket.close();
      bobSocket.close();
    }
  });
});

test('an account-wide workspace switch moves every open socket immediately', async () => {
  const player = createPlayer('Workspace Switch');
  const eventA = createEvent('Switch A');
  const eventB = createEvent('Switch B');
  activate(player, eventA);
  db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(eventB, player);

  await withServer(async ({ baseUrl }) => {
    const first = await connectSession(baseUrl, player);
    const second = await connectSession(baseUrl, player);
    try {
      await subscribe(first);
      await subscribe(second);
      const firstContext = payloads(first, Events.eventContextChanged);
      const secondContext = payloads(second, Events.eventContextChanged);
      const firstVotes = payloads(first, Events.votesChanged);
      const secondVotes = payloads(second, Events.votesChanged);

      assert.ok(setActiveEventForPlayer(player, eventB));
      switchPlayerEventScope(player, DEFAULT_GROUP_ID, eventB);
      broadcast(Events.votesChanged, { event: 'old' }, { groupId: DEFAULT_GROUP_ID, eventId: eventA });
      broadcast(Events.votesChanged, { event: 'new' }, { groupId: DEFAULT_GROUP_ID, eventId: eventB });
      await settle();

      assert.deepEqual(firstContext, [{ eventId: eventB }]);
      assert.deepEqual(secondContext, [{ eventId: eventB }]);
      assert.deepEqual(firstVotes, [{ event: 'new' }]);
      assert.deepEqual(secondVotes, [{ event: 'new' }]);
    } finally {
      first.close();
      second.close();
    }
  });
});

test('event participation is revalidated immediately before delivery', async () => {
  const player = createPlayer('Revoked Participant');
  const eventId = createEvent('Revoked Event');
  activate(player, eventId);

  await withServer(async ({ baseUrl }) => {
    const socket = await connectSession(baseUrl, player);
    try {
      await subscribe(socket);
      const changes = payloads(socket, Events.votesChanged);
      db.prepare('DELETE FROM event_participants WHERE event_id = ? AND player_id = ?').run(eventId, player);
      fallbackPlayerEventContext(player, eventId);
      broadcast(Events.votesChanged, { secret: true }, { groupId: DEFAULT_GROUP_ID, eventId });
      await settle();
      assert.deepEqual(changes, []);
    } finally {
      socket.close();
    }
  });
});

test('event kiosks receive only their exact event and only sanitized refresh payloads', async () => {
  const owner = createPlayer('Kiosk Owner');
  const eventA = createEvent('Kiosk A');
  const eventB = createEvent('Kiosk B');
  const token = issueKioskToken(DEFAULT_GROUP_ID, eventA, owner, 'Event A TV').token;

  await withServer(async ({ baseUrl }) => {
    const kiosk = await connectKiosk(baseUrl, token);
    try {
      const tournamentChanges = payloads(kiosk, Events.tournamentsChanged);
      const banners = payloads(kiosk, Events.pushSent);
      broadcast(Events.tournamentsChanged, { privateLobby: 'secret' }, { groupId: DEFAULT_GROUP_ID, eventId: eventA });
      broadcast(Events.tournamentsChanged, { foreign: true }, { groupId: DEFAULT_GROUP_ID, eventId: eventB });
      broadcast(Events.pushSent, { title: 'Event A' }, { groupId: DEFAULT_GROUP_ID, eventId: eventA });
      broadcast(Events.pushSent, { title: 'Event B' }, { groupId: DEFAULT_GROUP_ID, eventId: eventB });
      await settle();
      assert.deepEqual(tournamentChanges, [null]);
      assert.deepEqual(banners, [{ title: 'Event A' }]);
    } finally {
      kiosk.close();
    }
  });
});

test('revoking a kiosk token stops its already-open socket', async () => {
  const owner = createPlayer('Revoked Kiosk Owner');
  const eventId = createEvent('Revoked Kiosk Event');
  const issued = issueKioskToken(DEFAULT_GROUP_ID, eventId, owner, 'Revocable TV');

  await withServer(async ({ baseUrl }) => {
    const kiosk = await connectKiosk(baseUrl, issued.token);
    try {
      const changes = payloads(kiosk, Events.liveStatusChanged);
      assert.equal(revokeKioskToken(DEFAULT_GROUP_ID, issued.scope.id), true);
      broadcast(Events.liveStatusChanged, { leaked: true }, { groupId: DEFAULT_GROUP_ID, eventId });
      await settle();
      assert.deepEqual(changes, []);
    } finally {
      kiosk.close();
    }
  });
});

test('recipient filters stay inside the concrete event and never include a kiosk', async () => {
  const alice = createPlayer('Recipient Alice');
  const bob = createPlayer('Recipient Bob');
  const eventId = createEvent('Recipient Event');
  activate(alice, eventId);
  activate(bob, eventId);
  const kioskToken = issueKioskToken(DEFAULT_GROUP_ID, eventId, alice, 'Recipient TV').token;

  await withServer(async ({ baseUrl }) => {
    const aliceSocket = await connectSession(baseUrl, alice);
    const bobSocket = await connectSession(baseUrl, bob);
    const kiosk = await connectKiosk(baseUrl, kioskToken);
    try {
      await subscribe(aliceSocket);
      await subscribe(bobSocket);
      const alicePush = payloads(aliceSocket, Events.pushSent);
      const bobPush = payloads(bobSocket, Events.pushSent);
      const kioskPush = payloads(kiosk, Events.pushSent);
      broadcast(
        Events.pushSent,
        { title: 'Only Alice' },
        { groupId: DEFAULT_GROUP_ID, eventId, recipientPlayerIds: [alice] },
      );
      await settle();
      assert.deepEqual(alicePush, [{ title: 'Only Alice' }]);
      assert.deepEqual(bobPush, []);
      assert.deepEqual(kioskPush, []);
    } finally {
      aliceSocket.close();
      bobSocket.close();
      kiosk.close();
    }
  });
});

test('the permanent base event is a concrete socket scope, not a group-room fallback', async () => {
  const player = createPlayer('Base Scope');
  await withServer(async ({ baseUrl }) => {
    const socket = await connectSession(baseUrl, player);
    try {
      assert.equal((await subscribe(socket)).eventId, BASE_EVENT_ID);
      const updates = payloads(socket, Events.playersChanged);
      broadcast(Events.playersChanged, null, { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID });
      await settle();
      assert.deepEqual(updates, [null]);
    } finally {
      socket.close();
    }
  });
});
