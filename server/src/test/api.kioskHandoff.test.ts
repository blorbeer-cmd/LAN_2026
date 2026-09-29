import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createEvent } from '../events';
import { db } from '../db';
import { createTestApp } from './testApp';
import { resolveKioskToken } from '../kioskTokens';

const app = createTestApp();

test('Broadcast handoff opens the selected LAN and is consumed exactly once', async () => {
  const now = Date.now();
  const first = createEvent('Handoff LAN A', { startsAt: now, endsAt: now + 3_600_000, eventTypeKey: 'lan' });
  const second = createEvent('Handoff LAN B', { startsAt: now, endsAt: now + 3_600_000, eventTypeKey: 'lan' });
  const general = createEvent('Handoff Treffen', { startsAt: now, endsAt: now + 3_600_000, eventTypeKey: 'general' });

  for (const event of [first, second]) {
    const opened = await request(app).post(`/api/admin/kiosk-handoff?eventId=${encodeURIComponent(event.id)}`);
    assert.equal(opened.status, 303, JSON.stringify(opened.body));
    const redirect = new URL(opened.headers.location, 'http://localhost');
    assert.equal(redirect.pathname, '/kiosk.html');
    assert.equal(redirect.searchParams.get('account'), `kiosk-${event.id}`);
    const code = new URLSearchParams(redirect.hash.slice(1)).get('handoff');
    assert.match(code ?? '', /^[0-9a-f]{64}$/);
    const [won, replay] = await Promise.all([
      request(app).post('/api/kiosk/handoff').send({ code }),
      request(app).post('/api/kiosk/handoff').send({ code }),
    ]);
    assert.deepEqual([won.status, replay.status].sort(), [200, 410]);
    const token = won.status === 200 ? won.body.token : replay.body.token;
    assert.equal(resolveKioskToken(token)?.eventId, event.id);
  }

  const forbidden = await request(app).post(`/api/admin/kiosk-handoff?eventId=${first.id}`).set('Cookie', 'respawn_session=invalid');
  assert.equal(forbidden.status, 401);
  assert.equal((await request(app).post('/api/admin/kiosk-handoff?eventId=missing')).status, 404);
  assert.equal((await request(app).post(`/api/admin/kiosk-handoff?eventId=${general.id}`)).status, 404);
  assert.equal((await request(app).post('/api/kiosk/handoff').send({ code: 'bad' })).status, 400);

  const changed = createEvent('Handoff Geändert', { startsAt: now, endsAt: now + 3_600_000, eventTypeKey: 'lan' });
  const link = await request(app).post(`/api/admin/kiosk-handoff?eventId=${changed.id}`);
  const code = new URLSearchParams(new URL(link.headers.location, 'http://localhost').hash.slice(1)).get('handoff');
  db.prepare("UPDATE events SET event_type_key = 'general' WHERE id = ?").run(changed.id);
  assert.equal((await request(app).post('/api/kiosk/handoff').send({ code })).status, 410);
});
