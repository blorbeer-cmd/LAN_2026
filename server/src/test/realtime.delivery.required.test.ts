// Delivery-rule matrix for the scoped realtime model in required-auth mode:
// normal sockets only receive their subscribed group scope with a live
// membership re-check at delivery time, kiosk sockets only receive the
// allowlisted events of their validated token scope, and an accidentally
// unscoped fachlicher broadcast neither goes global nor disappears silently.
//
// config.authMode is patched for this file only — every test file runs in its
// own process (see TESTING.md), so the override cannot leak elsewhere.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { nanoid } from 'nanoid';
import { db, DEFAULT_GROUP_ID } from '../db';
import { config } from '../config';
import {
  broadcast,
  broadcastArcadeKiosk,
  broadcastInstanceSignal,
  createSocketAuthGuard,
  Events,
  registerArcadeKioskSockets,
  setIo,
} from '../realtime';
import { issueKioskToken, revokeKioskToken } from '../kioskTokens';
import { notifyPlayers } from '../push';
import { createSession, SESSION_COOKIE_NAME } from '../sessions';

const originalAuthMode = config.authMode;

before(() => {
  (config as { authMode: 'legacy' | 'required' }).authMode = 'required';
});

after(() => {
  (config as { authMode: 'legacy' | 'required' }).authMode = originalAuthMode;
});

function createPlayer(name: string): string {
  const id = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    `${name} ${id}`,
    nanoid(24),
    Date.now()
  );
  return id;
}

function createGroup(name: string): string {
  const id = nanoid();
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(id, name, Date.now());
  return id;
}

function addMembership(groupId: string, playerId: string, role = 'member', status = 'active'): void {
  db.prepare(
    `INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(group_id, player_id) DO UPDATE SET role = excluded.role, status = excluded.status`
  ).run(groupId, playerId, role, status, Date.now());
}

interface TestServer {
  io: Server;
  baseUrl: string;
}

async function withRequiredServer(fn: (server: TestServer) => Promise<void>, envKioskToken = ''): Promise<void> {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  io.use(createSocketAuthGuard('', 'required', envKioskToken));
  registerArcadeKioskSockets(io);
  setIo(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  try {
    await fn({ io, baseUrl });
  } finally {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    setIo(null);
  }
}

function connectSession(baseUrl: string, playerId: string): Promise<ClientSocket> {
  const sessionToken = createSession(playerId);
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
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

async function subscribeScope(socket: ClientSocket, groupId: string): Promise<void> {
  const result = await new Promise<{ ok: boolean }>((resolve) => {
    socket.emit('scope:subscribe', { groupId }, resolve);
  });
  assert.equal(result.ok, true);
}

function collect(socket: ClientSocket, event: string): { count: () => number } {
  let count = 0;
  socket.on(event, () => {
    count += 1;
  });
  return { count: () => count };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 75));

test('normal sockets receive only their subscribed group scope', async () => {
  const groupA = createGroup('Delivery A');
  const groupB = createGroup('Delivery B');
  const alice = createPlayer('Alice');
  const bob = createPlayer('Bob');
  const carol = createPlayer('Carol');
  addMembership(groupA, alice);
  addMembership(groupB, bob);
  addMembership(groupA, carol);

  await withRequiredServer(async ({ baseUrl }) => {
    const aliceSocket = await connectSession(baseUrl, alice);
    const bobSocket = await connectSession(baseUrl, bob);
    const carolSocket = await connectSession(baseUrl, carol); // member, but never subscribed
    try {
      await subscribeScope(aliceSocket, groupA);
      await subscribeScope(bobSocket, groupB);
      const aliceVotes = collect(aliceSocket, Events.votesChanged);
      const bobVotes = collect(bobSocket, Events.votesChanged);
      const carolVotes = collect(carolSocket, Events.votesChanged);

      broadcast(Events.votesChanged, { round: 1 }, { groupId: groupA });
      await settle();

      assert.equal(aliceVotes.count(), 1);
      assert.equal(bobVotes.count(), 0, 'a foreign group socket must not receive the event');
      assert.equal(carolVotes.count(), 0, 'an unsubscribed socket stays default-deny even as a member');
    } finally {
      aliceSocket.close();
      bobSocket.close();
      carolSocket.close();
    }
  });
});

test('kiosk sockets receive only allowlisted events for their validated token scope', async () => {
  const groupA = createGroup('Kiosk A');
  const groupB = createGroup('Kiosk B');
  const owner = createPlayer('Kiosk Owner');
  addMembership(groupA, owner, 'owner');
  const tokenA = issueKioskToken(groupA, null, owner, null).token;
  const tokenB = issueKioskToken(groupB, null, owner, null).token;

  await withRequiredServer(async ({ baseUrl }) => {
    const kioskA = await connectKiosk(baseUrl, tokenA);
    const kioskB = await connectKiosk(baseUrl, tokenB);
    try {
      const kioskAVotes = collect(kioskA, Events.votesChanged);
      const kioskBVotes = collect(kioskB, Events.votesChanged);
      const kioskASkills = collect(kioskA, Events.skillsChanged);
      const kioskAPush = collect(kioskA, Events.pushSent);

      const kioskAPlayers = collect(kioskA, Events.playersChanged);
      broadcast(Events.votesChanged, { round: 2 }, { groupId: groupA });
      broadcast(Events.skillsChanged, null, { groupId: groupA });
      broadcast(Events.pushSent, { title: 'Nur Gruppe A' }, { groupId: groupA });
      broadcast(Events.playersChanged, null, { groupId: groupA });
      await settle();

      assert.equal(kioskAVotes.count(), 1, 'the matching kiosk receives allowlisted group events');
      assert.equal(kioskAPush.count(), 1, 'push banners belong to the kiosk allowlist');
      assert.equal(kioskAPlayers.count(), 1, 'player-lifecycle signals refresh the group kiosk');
      assert.equal(kioskBVotes.count(), 0, 'a kiosk token of another group must receive nothing');
      assert.equal(kioskASkills.count(), 0, 'events outside the kiosk allowlist stay member-only');
    } finally {
      kioskA.close();
      kioskB.close();
    }
  });
});

test('kiosks receive refresh signals without fachliche payloads, members get the full payload', async () => {
  const groupA = createGroup('Kiosk Sanitize A');
  const owner = createPlayer('Kiosk Sanitize Owner');
  addMembership(groupA, owner, 'owner');
  const kioskToken = issueKioskToken(groupA, null, owner, null).token;

  await withRequiredServer(async ({ baseUrl }) => {
    const memberSocket = await connectSession(baseUrl, owner);
    const kiosk = await connectKiosk(baseUrl, kioskToken);
    try {
      await subscribeScope(memberSocket, groupA);
      const memberPayloads: unknown[] = [];
      const kioskPayloads: unknown[] = [];
      memberSocket.on(Events.tournamentsChanged, (payload: unknown) => memberPayloads.push(payload));
      kiosk.on(Events.tournamentsChanged, (payload: unknown) => kioskPayloads.push(payload));

      const sensitive = { type: 'match_ready', notify: { message: 'Lobby geheim / Passwort 1234' } };
      broadcast(Events.tournamentsChanged, sensitive, { groupId: groupA });
      await settle();

      assert.deepEqual(memberPayloads, [sensitive], 'members receive the full payload');
      assert.deepEqual(kioskPayloads, [null], 'the kiosk receives only the refresh signal');
    } finally {
      memberSocket.close();
      kiosk.close();
    }
  });
});

test('an event-scoped kiosk token does not receive group-room broadcasts', async () => {
  const groupA = createGroup('Kiosk Event A');
  const owner = createPlayer('Kiosk Event Owner');
  addMembership(groupA, owner, 'owner');
  const eventId = nanoid();
  db.prepare('INSERT INTO events (id, name, starts_at, group_id) VALUES (?, ?, ?, ?)').run(
    eventId,
    'Kiosk Event',
    Date.now(),
    groupA
  );
  const eventToken = issueKioskToken(groupA, eventId, owner, null).token;

  await withRequiredServer(async ({ baseUrl }) => {
    const eventKiosk = await connectKiosk(baseUrl, eventToken);
    try {
      const votes = collect(eventKiosk, Events.votesChanged);
      broadcast(Events.votesChanged, { round: 3 }, { groupId: groupA });
      broadcast(Events.votesChanged, { round: 4 }, { groupId: groupA, eventId });
      await settle();
      assert.equal(votes.count(), 1, 'exactly the event-scoped broadcast reaches the event kiosk');
    } finally {
      eventKiosk.close();
    }
  });
});

test('a direct push reaches only its resolved recipients and never the kiosk', async () => {
  const groupA = createGroup('Direct Push A');
  const alice = createPlayer('Push Alice');
  const bob = createPlayer('Push Bob');
  addMembership(groupA, alice, 'owner');
  addMembership(groupA, bob);
  const kioskToken = issueKioskToken(groupA, null, alice, null).token;

  await withRequiredServer(async ({ baseUrl }) => {
    const aliceSocket = await connectSession(baseUrl, alice);
    const bobSocket = await connectSession(baseUrl, bob);
    const kiosk = await connectKiosk(baseUrl, kioskToken);
    try {
      await subscribeScope(aliceSocket, groupA);
      await subscribeScope(bobSocket, groupA);
      const alicePush = collect(aliceSocket, Events.pushSent);
      const bobPush = collect(bobSocket, Events.pushSent);
      const kioskPush = collect(kiosk, Events.pushSent);

      notifyPlayers(
        [alice],
        { title: 'Privat', body: 'Nur Alice darf das lesen' },
        'direct',
        undefined,
        { groupId: groupA },
      );
      await settle();
      assert.equal(alicePush.count(), 1, 'the resolved recipient receives the direct push');
      assert.equal(bobPush.count(), 0, 'other group members must not see a direct push payload');
      assert.equal(kioskPush.count(), 0, 'the shared kiosk must never render a direct push');

      notifyPlayers([alice, bob], { title: 'Für alle', body: 'Gruppenweit' }, 'all', undefined, {
        groupId: groupA,
      });
      await settle();
      assert.equal(alicePush.count(), 2);
      assert.equal(bobPush.count(), 1);
      assert.equal(kioskPush.count(), 1, 'group-wide entries remain the kiosk banner source');
    } finally {
      aliceSocket.close();
      bobSocket.close();
      kiosk.close();
    }
  });
});

test('archiving the group silences an already-connected env-token kiosk too', async () => {
  await withRequiredServer(async ({ baseUrl }) => {
    const kiosk = await connectKiosk(baseUrl, 'env-kiosk-token');
    try {
      const votes = collect(kiosk, Events.votesChanged);
      broadcast(Events.votesChanged, { round: 1 }, { groupId: DEFAULT_GROUP_ID });
      await settle();
      assert.equal(votes.count(), 1, 'the env-token kiosk receives its default-group events');

      db.prepare('UPDATE groups SET archived_at = ? WHERE id = ?').run(Date.now(), DEFAULT_GROUP_ID);
      try {
        broadcast(Events.votesChanged, { round: 2 }, { groupId: DEFAULT_GROUP_ID });
        await settle();
        assert.equal(votes.count(), 1, 'an archived group stops delivery even without a token row');
      } finally {
        db.prepare('UPDATE groups SET archived_at = NULL WHERE id = ?').run(DEFAULT_GROUP_ID);
      }
    } finally {
      kiosk.close();
    }
  }, 'env-kiosk-token');
});

test('read-only kiosks never receive arcade watch lists', async () => {
  const groupA = createGroup('Watch List A');
  const owner = createPlayer('Watch List Owner');
  addMembership(groupA, owner, 'owner');
  const kioskToken = issueKioskToken(groupA, null, owner, null).token;
  const matchId = `watch-list-kiosk-${nanoid()}`;

  await withRequiredServer(async ({ io, baseUrl }) => {
    const kiosk = await connectKiosk(baseUrl, kioskToken);
    const memberSocket = await connectSession(baseUrl, owner);
    try {
      const kioskLists = collect(kiosk, 'arcade:watch:list');
      const memberLists = collect(memberSocket, 'arcade:watch:list');

      broadcastArcadeKiosk(io, {
        matchId,
        gameType: 'pong',
        running: true,
        players: [],
        scores: [],
      });
      await settle();

      assert.equal(kioskLists.count(), 0, 'watch summaries must never reach a read-only kiosk');
      assert.ok(memberLists.count() >= 1, 'regular sockets keep receiving the watch list');
    } finally {
      broadcastArcadeKiosk(io, { gameType: null, matchId });
      kiosk.close();
      memberSocket.close();
    }
  });
});

test('revoking a kiosk token stops delivery to its already-connected socket', async () => {
  const groupA = createGroup('Kiosk Revoke A');
  const owner = createPlayer('Kiosk Revoke Owner');
  addMembership(groupA, owner, 'owner');
  const issued = issueKioskToken(groupA, null, owner, null);

  await withRequiredServer(async ({ baseUrl }) => {
    const kiosk = await connectKiosk(baseUrl, issued.token);
    try {
      const votes = collect(kiosk, Events.votesChanged);
      broadcast(Events.votesChanged, { round: 1 }, { groupId: groupA });
      await settle();
      assert.equal(votes.count(), 1, 'delivery works while the token is valid');

      assert.equal(revokeKioskToken(groupA, issued.scope.id), true);
      broadcast(Events.votesChanged, { round: 2 }, { groupId: groupA });
      await settle();
      assert.equal(votes.count(), 1, 'a revoked token receives no further delivery');
    } finally {
      kiosk.close();
    }
  });
});

test('membership revocation stops delivery immediately, even on an open subscribed socket', async () => {
  const groupA = createGroup('Revoke A');
  const mallory = createPlayer('Mallory');
  addMembership(groupA, mallory);

  await withRequiredServer(async ({ baseUrl }) => {
    const socket = await connectSession(baseUrl, mallory);
    try {
      await subscribeScope(socket, groupA);
      const votes = collect(socket, Events.votesChanged);

      broadcast(Events.votesChanged, { round: 1 }, { groupId: groupA });
      await settle();
      assert.equal(votes.count(), 1, 'delivery works while the membership is active');

      addMembership(groupA, mallory, 'member', 'removed');
      broadcast(Events.votesChanged, { round: 2 }, { groupId: groupA });
      await settle();
      assert.equal(votes.count(), 1, 'no further delivery after the membership was revoked');
    } finally {
      socket.close();
    }
  });
});

test('switching the subscribed group ends the previous scope and serves the new one', async () => {
  const groupA = createGroup('Switch A');
  const groupB = createGroup('Switch B');
  const dave = createPlayer('Dave');
  addMembership(groupA, dave);
  addMembership(groupB, dave);

  await withRequiredServer(async ({ baseUrl }) => {
    const socket = await connectSession(baseUrl, dave);
    try {
      await subscribeScope(socket, groupA);
      const votes = collect(socket, Events.votesChanged);

      broadcast(Events.votesChanged, { round: 1 }, { groupId: groupA });
      await settle();
      assert.equal(votes.count(), 1);

      await subscribeScope(socket, groupB);
      broadcast(Events.votesChanged, { round: 2 }, { groupId: groupA });
      broadcast(Events.votesChanged, { round: 3 }, { groupId: groupB });
      await settle();
      assert.equal(votes.count(), 2, 'after the switch only the new group scope is delivered');
    } finally {
      socket.close();
    }
  });
});

test('an unscoped fachlicher broadcast throws outside production and delivers nothing', async () => {
  const groupA = createGroup('Unscoped A');
  const erin = createPlayer('Erin');
  addMembership(groupA, erin);

  await withRequiredServer(async ({ baseUrl }) => {
    const socket = await connectSession(baseUrl, erin);
    try {
      await subscribeScope(socket, groupA);
      const votes = collect(socket, Events.votesChanged);

      assert.throws(
        () => (broadcast as (event: string, payload: unknown, scope?: unknown) => void)(Events.votesChanged, { round: 1 }),
        /ohne Gruppen-Scope/
      );
      assert.throws(() => broadcast(Events.votesChanged, { round: 1 }, { groupId: '' }), /ohne Gruppen-Scope/);
      await settle();
      assert.equal(votes.count(), 0, 'nothing may be delivered for an unscoped broadcast');
    } finally {
      socket.close();
    }
  });
});

test('broadcastInstanceSignal reaches every socket with a null payload, but only for allowlisted names', async () => {
  const groupA = createGroup('Signal A');
  const frank = createPlayer('Frank');
  addMembership(groupA, frank);

  await withRequiredServer(async ({ baseUrl }) => {
    const subscribed = await connectSession(baseUrl, frank);
    const unsubscribed = await connectSession(baseUrl, frank);
    try {
      await subscribeScope(subscribed, groupA);
      const payloads: unknown[] = [];
      subscribed.on(Events.groupsChanged, (payload: unknown) => payloads.push(payload));
      const unsubscribedSignals = collect(unsubscribed, Events.groupsChanged);

      broadcastInstanceSignal(Events.groupsChanged);
      await settle();

      assert.deepEqual(payloads, [null], 'the instance signal never carries data');
      assert.equal(unsubscribedSignals.count(), 1, 'membership-lifecycle refreshes reach unscoped sockets too');
      assert.throws(() => broadcastInstanceSignal(Events.votesChanged), /kein freigegebenes globales Instanz-Signal/);
    } finally {
      subscribed.close();
      unsubscribed.close();
    }
  });
});
