import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { io as ioClient, Socket } from 'socket.io-client';

const PORT = 3911;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RECOVERY_CODE = 'phase5e-isolation-recovery';

let serverProcess: ChildProcess;
let adminId = '';
let adminCookie = '';
let groupA = '';
let groupB = '';

async function waitForServer(): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    try {
      if ((await fetch(`${BASE_URL}/api/health`)).ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Phase-5e test server did not become ready');
}

async function api(pathname: string, init: RequestInit = {}, groupId?: string, includeCookie = true): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (includeCookie) headers.set('cookie', adminCookie);
  if (groupId) headers.set('x-group-id', groupId);
  return fetch(`${BASE_URL}${pathname}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(5_000) });
}

function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE_URL, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: cookie },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

async function subscribe(socket: Socket, groupId: string): Promise<void> {
  const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    socket.emit('scope:subscribe', { groupId }, resolve);
  });
  assert.deepEqual(result, { ok: true, groupId, eventId: null });
}

before(async () => {
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_FILE: ':memory:',
      AUTH_MODE: 'required',
      MULTI_GROUPS_ENABLED: '1',
      ADMIN_RECOVERY_CODE: RECOVERY_CODE,
      COOKIE_SECURE: '0',
      KIOSK_TOKEN: 'legacy-phase5e-token',
    },
    stdio: 'ignore',
  });
  await waitForServer();

  const registered = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: RECOVERY_CODE, name: 'Phase 5e Admin', password: 'phase5e admin password' }),
  });
  assert.equal(registered.status, 201);
  adminId = ((await registered.json()) as { id: string }).id;
  const setCookie = registered.headers.get('set-cookie');
  assert.ok(setCookie);
  adminCookie = setCookie!.split(';')[0];

  const createdA = await api('/api/groups', { method: 'POST', body: JSON.stringify({ name: 'Phase 5e A' }) });
  const createdB = await api('/api/groups', { method: 'POST', body: JSON.stringify({ name: 'Phase 5e B' }) });
  if (createdA.status !== 201) throw new Error(`group A create failed: ${createdA.status} ${await createdA.text()}`);
  if (createdB.status !== 201) throw new Error(`group B create failed: ${createdB.status} ${await createdB.text()}`);
  groupA = ((await createdA.json()) as { id: string }).id;
  groupB = ((await createdB.json()) as { id: string }).id;
});

after(() => serverProcess?.kill());

test('two independent browser/agent sockets receive only their current group delivery', async () => {
  // The first socket represents the browser tab; the second is a separately
  // authenticated agent-side connection. They deliberately share an account
  // but hold different active rooms, which catches room-name trust bugs.
  const browserSocket = await connect(adminCookie);
  const agentSocket = await connect(adminCookie);
  try {
    await subscribe(browserSocket, groupA);
    await subscribe(agentSocket, groupB);
    let browserEvents = 0;
    let agentEvents = 0;
    browserSocket.on('live:changed', () => { browserEvents += 1; });
    agentSocket.on('live:changed', () => { agentEvents += 1; });

    const changed = await api(`/api/live/${adminId}/note`, {
      method: 'POST',
      body: JSON.stringify({ note: 'nur Gruppe A' }),
    }, groupA);
    assert.equal(changed.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(browserEvents, 1);
    assert.equal(agentEvents, 0);

    const denied = await new Promise<{ ok: boolean }>((resolve) => {
      agentSocket.emit('scope:subscribe', { groupId: 'unknown-group' }, resolve);
    });
    assert.equal(denied.ok, false);
  } finally {
    browserSocket.close();
    agentSocket.close();
  }
});
