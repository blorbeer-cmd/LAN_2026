// Browser E2E test, community shard: info, arrivals, broadcasts, draft and kiosk.
// One owner process drives the real built server + real Chromium; the shared
// server session, browser context and page live in ./flowsShared.fixture.
// Sibling tests here intentionally share that state and run in order.

import assert from 'node:assert/strict';
import { E2E_KIOSK_TOKEN } from './authHelpers';
import {
  flowTest,
  registerFlowFixture,
  BASE_URL,
  page,
  adminCookie,
  alice,
  openMatchmakingHistory,
  openTeams,
  openOrgaTab,
  switchIdentityAndOpenArrivals,
  createAccountForFlow,
} from './flowsShared.fixture';
import { openMoreViewEntry } from './navHelpers';

registerFlowFixture('community');

flowTest('Info: create an entry, see it rendered', async () => {
  // Info is a topbar dialog, reachable from whatever view is open.
  await page.click('#info-btn');
  await page.waitForSelector('#info-new-btn');
  await page.click('#info-new-btn');
  await page.fill('#info-title', 'WLAN');
  await page.fill('#info-content', 'Netz: Respawn\nPasswort: kartoffel');
  await page.click('#info-form button[type="submit"]');
  await page.waitForSelector('text=kartoffel');

  // Regression: saving reloads the dialog's own data (load() -> renderOpenDialog()),
  // which used to rebuild .modal-body without restoring focus - the entry
  // form's close() already returned focus to "Eintrag anlegen" by this point,
  // and the async reload's DOM rebuild must not then drop it back to <body>.
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'info-new-btn',
    'focus must stay on "Eintrag anlegen" after the Info dialog refreshes its data'
  );

  // Modals stack now that Info is one itself: Escape must dismiss only the
  // topmost dialog, not the whole stack underneath it. Delete lives in the
  // entry's detail dialog.
  await page.click('[data-open-entry]');
  await page.waitForSelector('[data-detail-delete]');
  await page.click('[data-detail-delete]');
  await page.waitForSelector('[data-confirm]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-confirm]', { state: 'detached' });
  assert.equal(await page.locator('[data-detail-delete]').count(), 1, 'Escape must not close the detail dialog underneath');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-detail-delete]', { state: 'detached' });
  assert.equal(await page.locator('.info-board-modal').count(), 1, 'Escape must not close the Info dialog underneath');
  await page.waitForSelector('text=kartoffel');

  await page.click('#info-new-btn');
  await page.fill('#info-title', 'Discord');
  await page.keyboard.press('Escape');
  // The entry form asks before discarding; that question is now the topmost
  // dialog and Escape declines it without taking Info down with it.
  await page.waitForSelector('[data-confirm]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-confirm]', { state: 'detached' });
  assert.equal(await page.locator('#info-title').count(), 1, 'the entry form stays open after declining');
  assert.equal(await page.locator('.info-board-modal').count(), 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-confirm]');
  await page.click('[data-confirm]');
  await page.waitForSelector('#info-title', { state: 'detached' });

  // The dialog stays open over the current view until it is dismissed; as a
  // pure reference dialog it has no close button, Escape closes it.
  assert.equal(await page.locator('.info-board-modal').count(), 1);
  assert.equal(await page.locator('.info-board-modal [data-close]').count(), 0);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.info-board-modal', { state: 'detached' });
});

flowTest('Modal: a pointer interaction started inside the dialog does not close it, but a real backdrop click still does', async () => {
  // Regression for modal.js's backdrop click-to-close: a click event's target
  // is the nearest common ancestor of its mousedown and mouseup targets, not
  // necessarily where either one landed. Selecting text (or dragging a
  // slider) that starts inside the dialog and ends on the bare backdrop used
  // to report the backdrop as e.target and close the dialog mid-interaction.
  await page.click('#info-btn');
  await page.waitForSelector('.info-board-modal');
  const title = page.locator('.info-board-modal .modal-header h2');
  const titleBox = await title.boundingBox();
  assert.ok(titleBox, 'modal title must be visible to anchor the drag');

  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
  await page.mouse.down();
  // Drag out past the dialog onto the bare backdrop before releasing, the
  // same motion a text selection or slider drag produces.
  await page.mouse.move(5, 5, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.info-board-modal').count(), 1, 'a drag that started inside the dialog must not close it');

  // A genuine backdrop click - both mousedown and mouseup on the bare
  // backdrop - still closes the dialog as before.
  await page.mouse.move(5, 5);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForSelector('.info-board-modal', { state: 'detached' });
});

flowTest('Info: entries are rows with a short preview; the detail dialog holds the full text', async () => {
  await page.click('#info-btn');
  await page.waitForSelector('#info-new-btn');

  await page.click('#info-new-btn');
  await page.fill('#info-title', 'Discord');
  await page.fill('#info-content', 'discord.gg/example');
  await page.click('#info-form button[type="submit"]');
  await page.waitForSelector('text=discord.gg/example');

  // A long entry shows only a two-line preview in the list; the rest is in
  // its detail dialog instead of stretching the row.
  const longContent = Array.from({ length: 6 }, (_, i) => `Regel ${i + 1}: Sei nett zueinander.`).join('\n');
  await page.click('#info-new-btn');
  await page.fill('#info-title', 'Hausregeln für unsere gemeinsame LAN im September');
  await page.fill('#info-content', longContent);
  await page.click('#info-form button[type="submit"]');
  const rulesEntry = page.locator('[data-info-entry]', { hasText: 'Hausregeln' });
  await rulesEntry.waitFor();
  const preview = rulesEntry.locator('.info-board-preview');
  assert.equal(await preview.evaluate((el) => el.scrollHeight > el.clientHeight), true, 'a long preview is clamped');

  // Wide screens list the entries in two columns, filled left first.
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 1100, height: 844 });
  const lefts = await page.locator('.info-board-list > .profile-row').evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().left)));
  assert.equal(new Set(lefts).size, 2);
  assert.equal(lefts[0] < lefts[lefts.length - 1], true);

  // On a phone the one copy action stays inside its row beside a long title.
  await page.setViewportSize({ width: 390, height: 844 });
  const actionFits = await rulesEntry.evaluate((row) => {
    const bounds = row.getBoundingClientRect();
    const action = row.querySelector('[data-copy-entry]')!.getBoundingClientRect();
    return action.left >= bounds.left - 0.5 && action.right <= bounds.right + 0.5;
  });
  assert.equal(actionFits, true, 'the copy action must stay inside the row beside a long title');
  await page.setViewportSize(originalViewport);

  await rulesEntry.locator('[data-open-entry]').click();
  await page.waitForSelector('.info-board-content');
  assert.equal(await page.locator('.info-board-content').getByText('Regel 6: Sei nett zueinander.').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.info-board-content', { state: 'detached' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.info-board-modal', { state: 'detached' });
});

flowTest('An- & Abreise: carpool marks the driver, enforces seats, driver can only delete', async () => {
  // A third player to later demonstrate a full carpool.
  await createAccountForFlow('E2E Carol');

  await openOrgaTab('arrivals');
  await page.waitForSelector('[data-new-carpool="arrival"]');
  assert.equal((await page.locator('[data-new-carpool="arrival"]').textContent())?.trim(), 'Fahrt anlegen');

  // Current identity is still "E2E Alice Pro" - she creates the carpool and
  // becomes its driver, with just 1 free passenger seat.
  await page.click('[data-new-carpool="arrival"]');
  await page.fill('#carpool-label', 'Auto Alice');
  await page.fill('#carpool-location', 'Hamburg');
  await page.fill('#carpool-seats', '1');
  await page.click('#carpool-form button[type="submit"]');
  await page.waitForSelector('.arrivals-member-row:has-text("E2E Alice Pro"):has-text("Fahrer")');
  await page.waitForSelector('.arrivals-free-seat-row');
  // The driver only ever gets a direct "Bearbeiten" (deleting lives in its
  // dialog), never Eintragen/Austragen, and no second carpool of the same
  // direction.
  await page.waitForSelector('[data-carpool] .arrivals-carpool-action > [data-edit-carpool]');
  assert.equal(await page.locator('[data-carpool] .action-menu').count(), 0);
  assert.equal(await page.locator('[data-leave-carpool], [data-join-carpool]').count(), 0);
  assert.equal(await page.locator('[data-new-carpool="arrival"]').count(), 0);

  // Switch identity to Bob: he joins, taking the last seat.
  await switchIdentityAndOpenArrivals('E2E Bob');
  await page.waitForSelector('[data-join-carpool]:text-is("Eintragen")');
  await page.click('[data-join-carpool]');
  await page.waitForSelector('.arrivals-free-seat-row', { state: 'detached' });
  await page.waitForSelector('[data-leave-carpool]:text-is("Austragen")');

  // "Alle Zeiten" below shows who Bob is riding with.
  await page.click('[data-arrivals-times] > summary');
  const bobTimesRow = page.locator('.arrivals-times-row', { hasText: 'E2E Bob' });
  await bobTimesRow.waitFor();
  assert.match((await bobTimesRow.textContent()) ?? '', /mit E2E Alice Pro/);

  // A third player finds the carpool full and can't join.
  await switchIdentityAndOpenArrivals('E2E Carol');
  await page.waitForSelector('.arrivals-member-row:has-text("E2E Bob")');
  assert.equal(await page.locator('.arrivals-free-seat-row').count(), 0);
  assert.equal(await page.locator('[data-join-carpool]').count(), 0);

  // Bob leaves, freeing the seat back up; the driver deletes the group.
  await switchIdentityAndOpenArrivals('E2E Bob');
  await page.click('[data-leave-carpool]');
  await page.waitForSelector('.arrivals-free-seat-row');
  assert.doesNotMatch((await bobTimesRow.textContent()) ?? '', /mit E2E Alice Pro/);

  await switchIdentityAndOpenArrivals('E2E Alice Pro');
  await page.click('[data-edit-carpool]');
  await page.click('#carpool-form [data-carpool-delete]');
  await page.waitForSelector('[data-confirm]');
  // Destructive confirm dialogs must default focus to Cancel (not the danger
  // action) and use a concrete verb, so a stray Enter right after opening
  // cannot re-trigger the deletion.
  assert.equal(
    await page.locator('.modal-body [data-cancel]').evaluate((el) => el === document.activeElement),
    true
  );
  assert.equal(await page.locator('[data-confirm]').innerText(), 'Löschen');
  assert.equal(
    await page.locator('[data-confirm]').evaluate((el) => el.classList.contains('btn-danger')),
    true
  );
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-confirm]', { state: 'detached' });
  // The carpool must still exist - Enter cancelled instead of confirming, and
  // only the confirmation closed while its edit dialog stays open.
  await page.waitForSelector('#carpool-form');
  await page.waitForSelector('[data-carpool]', { state: 'attached' });

  // Deleting for real still works through an explicit confirm click, which
  // also closes the edit dialog.
  await page.click('#carpool-form [data-carpool-delete]');
  await page.click('[data-confirm]');
  await page.waitForSelector('text=Noch keine Fahrgemeinschaft.');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
});

flowTest('Durchsage: notification center can navigate, mark read and remove without duplicating Home', async () => {
  await openMoreViewEntry(page, '[data-navigate="broadcast"]');
  await page.waitForSelector('#broadcast-message');
  const defaultEndsAt = new Date(await page.inputValue('#broadcast-ends-at')).getTime();
  assert.ok(defaultEndsAt >= Date.now() + 55 * 60 * 1000);
  assert.ok(defaultEndsAt <= Date.now() + 65 * 60 * 1000);
  await page.fill('#broadcast-message', 'Essen ist da!');
  await page.click('#broadcast-form button[type="submit"]');
  // Wait for the durable signal (the row in "Aktuell"), not the 2.6s
  // confirmation toast — too short-lived to assert on reliably.
  try {
    await page.waitForSelector('.broadcast-table-row:has-text("Essen ist da!")', { timeout: 8000 });
  } catch (err) {
    console.error('[debug] view:', (await page.innerText('#view-container')).slice(0, 500));
    console.error('[debug] toasts:', await page.innerText('#toast-container'));
    const apiState = await page.request.get(`${BASE_URL}/api/broadcasts`);
    console.error('[debug] api:', JSON.stringify(await apiState.json()).slice(0, 300));
    throw err;
  }

  // The highlighted strip shows the newest active push on any view and
  // deep-links back into Durchsagen. Opening it marks the entry as read,
  // while the bell keeps it in the durable history. (Auswertung is
  // admin-mode-only, so "any view" is exercised with Home here instead.)
  await page.click('.nav-btn[data-view="home"]');
  const highlight = page.locator('#notification-highlight:has-text("Essen ist da!")');
  await highlight.waitFor();
  // The creator has its own slot after the title: the title is truncated
  // first, and even a name wider than a phone line wraps inside the text area
  // instead of running under the dismiss button or scrolling the page.
  const actor = highlight.locator('.notification-highlight-actor');
  const actorText = await actor.innerText();
  assert.match(actorText, /^von \S/);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: viewport.height });
  const geometry = await highlight.evaluate((el) => {
    const actorEl = el.querySelector('.notification-highlight-actor')!;
    const original = actorEl.textContent;
    actorEl.textContent = `von ${'W'.repeat(60)}`;
    const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
    const result = {
      actorRight: rect('.notification-highlight-actor').right,
      textRight: rect('.notification-highlight-text').right,
      dismissLeft: rect('.notification-highlight-dismiss').left,
      pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
    };
    actorEl.textContent = original;
    return result;
  });
  await page.setViewportSize(viewport);
  assert.ok(geometry.actorRight <= geometry.textRight, `long creator name overflows: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.actorRight <= geometry.dismissLeft, `long creator name covers the dismiss button: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.pageOverflows, false);
  assert.equal(await actor.innerText(), actorText);
  await highlight.locator('[data-notification-highlight-navigate]').click();
  await page.waitForSelector('#broadcast-message');
  await page.waitForSelector('#notification-highlight', { state: 'hidden' });

  await page.click('#notifications-btn');
  assert.equal(await page.getAttribute('#notifications-btn', 'aria-expanded'), 'true');
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'notification center must not create horizontal page scroll on mobile',
  );
  const panelBox = await page.locator('#notifications-panel').boundingBox();
  assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= 390);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#notifications-panel', { state: 'hidden' });
  assert.equal(await page.getAttribute('#notifications-btn', 'aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'notifications-btn');
  await page.click('#notifications-btn');
  const foodNotification = page.locator('.notification-center-entry:has-text("Essen ist da!")');
  await foodNotification.waitFor();
  assert.ok(!((await foodNotification.getAttribute('class')) ?? '').includes('is-unread'));

  // Removing is personal and leaves the durable Durchsage itself intact.
  await foodNotification.locator('[data-notification-hide]').click();
  await foodNotification.waitFor({ state: 'detached' });
  await page.click('[data-notification-close]');
  await page.waitForSelector('.broadcast-table-row:has-text("Essen ist da!")');

  // Home no longer renders a second notification history in a different
  // style; notifications live only under the bell.
  await page.click('.nav-btn[data-view="home"]');
  assert.equal(await page.locator('.section-title:has-text("Mitteilungen")').count(), 0);

  // A second message can be ended early by its creator; it remains a past
  // notification until this player removes it from the center.
  await openMoreViewEntry(page, '[data-navigate="broadcast"]');
  await page.fill('#broadcast-message', 'Turnier startet gleich!');
  await page.click('#broadcast-form button[type="submit"]');
  const activeRow = page.locator('.broadcast-table-row:has-text("Turnier startet gleich!")');
  await activeRow.waitFor();
  // The whole row opens the details with the full message; the creator can
  // end it there as well as from the row's fixed action column.
  await activeRow.locator('[data-broadcast-detail]').click();
  await page.waitForSelector('.broadcast-detail-message:has-text("Turnier startet gleich!")');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.broadcast-detail-modal', { state: 'detached' });
  await activeRow.locator('[data-end-broadcast]').click();
  // An ended broadcast leaves "Aktuell" for the collapsed history.
  await page
    .locator('details[data-broadcast-history] .broadcast-table-row:has-text("Turnier startet gleich!")', { hasText: 'Beendet' })
    .waitFor({ state: 'attached' });
  await page.click('#notifications-btn');
  const endedNotification = page.locator('.notification-center-entry:has-text("Turnier startet gleich!")');
  await endedNotification.waitFor();
  // Ending the broadcast before anyone opened this notification resolves it
  // server-side (resolvePushTopic in routes/broadcasts.ts): the center shows
  // it as already settled rather than as something still needing attention,
  // even though it was never explicitly marked read.
  await endedNotification.locator('.notification-center-meta .badge:has-text("Obsolet")').waitFor();
  assert.ok(!((await endedNotification.getAttribute('class')) ?? '').includes('is-unread'));
  // "Alle gelesen" has nothing to do here either: every visible entry is
  // already obsolete, so it stays disabled instead of offering a click with
  // no visible effect.
  assert.ok(await page.isDisabled('[data-notifications-seen-all]'));
  // The dedicated cleanup action only ever removes settled entries like this
  // one, leaving anything still open untouched.
  await page.click('[data-notifications-hide-resolved]');
  await endedNotification.waitFor({ state: 'detached' });
  // Earlier flows in this shared fixture may have left their own, unrelated
  // entries in this player's history — clear those the regular way so the
  // panel is guaranteed empty for the next flow, regardless of what "Aufräumen"
  // already removed above.
  if ((await page.locator('.notification-center-entry').count()) > 0) {
    await page.click('[data-notifications-hide-all]');
    // Confirming lands a pointerdown outside `.notification-center`, which the
    // panel's own document-level listener reads as "click outside" and closes
    // it — even though the deletion underneath still goes through. Reopen it
    // to actually observe the resulting empty state below.
    await page.click('[data-confirm]');
    await page.click('#notifications-btn');
  }
  await page.waitForSelector('text=Keine Mitteilungen.');
  await page.click('[data-notification-close]');

  // A visible time-limited banner removes itself at its deadline even when
  // no later socket event happens and the user never clicks it.
  const meResponse = await page.request.get(`${BASE_URL}/api/me`);
  assert.equal(meResponse.status(), 200);
  const { id: myId } = await meResponse.json() as { id: string };
  const expiring = await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId: myId, message: 'Läuft automatisch ab', endsAt: Date.now() + 2000 },
  });
  assert.equal(expiring.status(), 201);
  // APIRequestContext bypasses the sending browser. Phase 5c intentionally
  // has no delivery signal, so model the browser's explicit REST refresh.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:notifications-refresh')));
  await page.waitForSelector('#notification-highlight:has-text("Läuft automatisch ab")');
  await page.waitForSelector('#notification-highlight', { state: 'hidden', timeout: 5000 });
});

flowTest('Captain-Draft: pick captains, run the live draft to completion', async () => {
  await openTeams();
  await page.click('[data-mm-mode="draft"]');
  await page.waitForSelector('[data-captain-toggle]');

  // The session account ("E2E Alice Pro") must be a captain so this page is
  // allowed to pick; E2E Bob is the second captain, everyone else is pool.
  await page.click('label.check-row:has-text("E2E Alice Pro") input[data-captain-toggle]');
  await page.click('label.check-row:has-text("E2E Bob") input[data-captain-toggle]');
  await page.waitForSelector('#draft-start:not([disabled])');
  await page.click('#draft-start');
  await page.waitForSelector('text=Captain Draft läuft');

  // The destructive draft-cancel confirmation must read differently than the
  // neighboring Abbrechen button (both used to say "Abbrechen"). Dismiss via
  // the dialog's own Abbrechen button so the draft keeps running afterward.
  await page.click('#draft-cancel');
  await page.waitForSelector('[data-confirm]');
  assert.equal(await page.locator('[data-confirm]').innerText(), 'Draft abbrechen');
  assert.notEqual(
    await page.locator('[data-confirm]').innerText(),
    await page.locator('.modal-body [data-cancel]').innerText(),
  );
  await page.click('.modal-body [data-cancel]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });

  // Live board appears; it's Alice's turn (first captain). Keep picking
  // until the pool is empty — the last player is auto-assigned server-side,
  // which ends the draft and returns the view to the regular Teams-auslosen
  // page (no pinned "draft result" card — see matchmaking.js).
  await page.waitForSelector('text=Captain Draft läuft');
  for (let i = 0; i < 8; i++) {
    if ((await page.locator('text=Captain Draft läuft').count()) === 0) break;
    const pick = page.locator('button[data-draft-pick]').first();
    if ((await pick.count()) === 0) break;
    await pick.click();
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('text=Captain Draft läuft', { state: 'detached', timeout: 5000 });

  // The finished draft landed in the shared Historie (not pinned to the
  // page top) with the usual "Ergebnis eintragen" follow-up available there.
  await page.waitForSelector('details.history-details:has(summary:has-text("Historie"))');
  await openMatchmakingHistory();
  const openTile = page.locator('.matchmaking-open-draws');
  if ((await openTile.getAttribute('open')) === null) await openTile.locator(':scope > summary').click();
  await page.waitForSelector('#match-history-open [data-record-draw]', { state: 'attached' });
});

flowTest('the device back button steps back through in-app views instead of leaving the tool', async () => {
  // Land on a known view, then navigate through two more — each deliberate
  // tab switch should push a history entry (see switchView in app.js).
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('.view-title');
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Vote');
  // Auswertung is admin-mode-only, so the third view here is Spiele instead.
  await page.click('.nav-btn[data-view="gameCatalog"]');
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Spiele');

  // Back should undo the last switch (Spiele -> votes), not leave the
  // single-page app (there is nowhere else to navigate to in this test, so
  // if this fell through to real browser navigation the page would end up
  // blank/erroring instead of showing the votes view).
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Vote');

  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Home');

  // Forward should redo the same steps.
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Vote');
});

flowTest('Aktuell: an open vote appears as a compact navigation row on Home', async () => {
  await page.click('.nav-btn[data-view="votes"]');
  await page.click('#votes-new');
  await page.fill('#votes-title', 'Freitagabend-Runde');
  await page.click('#votes-start');
  await page.waitForSelector('[data-votes-close]'); // only rendered once ctx.refresh() shows the round as open

  const openedVote = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
  assert.equal(openedVote.title, 'Freitagabend-Runde');

  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('section.grouped-page-section:has(h2:text-is("Aktuell"))');
  const currentVote = page.locator(`[data-current-item="vote:${openedVote.round}"]`);
  await currentVote.waitFor();
  // The compact row is a single full-row navigation action into the vote; the
  // per-item dismiss control was removed with the compact redesign.
  assert.equal(await currentVote.locator('[data-dismiss-current]').count(), 0);
  assert.equal(await currentVote.locator('.home-current-navigate').getAttribute('data-navigate'), 'votes');

  // Leave no open round behind for later tests.
  await page.click('.nav-btn[data-view="votes"]');
  await page.click('[data-votes-close]');
  await page.waitForSelector('#votes-new');
});

flowTest('Kiosk: centers tournament content and shows only the latest feature push across the full width', async () => {
  const playerId = alice.id;

  // Send a Durchsage first, then trigger a different feature's push (opening
  // a food order) — the banner must show the *food order's* push afterward,
  // proving it reflects any notifyPlayers() call, not only Durchsagen.
  await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId, message: 'Kiosk-Test-Durchsage' },
  });
  const opponent = await page.request.post(`${BASE_URL}/api/players`, { data: { name: 'Kiosk Gegner' } });
  const opponentId = (await opponent.json()).id;
  const games = await (await page.request.get(`${BASE_URL}/api/games`)).json();
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'points', title: 'Kiosk Vote', gameIds: [games[0].id, games[1].id] },
  });
  await page.request.post(`${BASE_URL}/api/votes/points`, {
    data: { playerId, entries: [{ gameId: games[0].id, points: 5 }, { gameId: games[1].id, points: 3 }] },
  });
  await page.request.post(`${BASE_URL}/api/votes/close`);
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'single', title: 'Stichwahl: Kiosk Vote', gameIds: [games[0].id, games[1].id] },
  });
  await page.request.post(`${BASE_URL}/api/votes`, { data: { playerId, gameId: games[1].id } });
  await page.request.post(`${BASE_URL}/api/tournaments`, {
    data: {
      gameId: games[0].id,
      format: 'single_elimination',
      teams: [
        { name: 'Kiosk Team Blau', playerIds: [playerId] },
        { name: 'Kiosk Team Pink', playerIds: [opponentId] },
      ],
    },
  });
  const sendAt = Date.now() + 3600_000;
  await page.request.post(`${BASE_URL}/api/food-orders`, {
    data: { playerId, title: 'Kiosk-Test-Pizza', sendAt, link: 'https://kiosk-test.example/karte' },
  });

  await page.setViewportSize({ width: 1280, height: 720 });

  // A newly created LAN can sign in with its automatic account and the one
  // shared password. This creates no normal browser session; the page only
  // stores the resulting event-scoped kiosk token.
  const loginEventResponse = await page.request.post(`${BASE_URL}/api/events`, {
    data: {
      name: 'Kiosk Login E2E',
      startsAt: Date.now() + 7_200_000,
      endsAt: Date.now() + 10_800_000,
      eventType: 'lan',
    },
  });
  assert.equal(loginEventResponse.status(), 201, await loginEventResponse.text());
  const loginEvent = await loginEventResponse.json();
  await page.goto(`${BASE_URL}/kiosk.html?account=${encodeURIComponent(`kiosk-${loginEvent.id}`)}`);
  await page.waitForSelector('[data-kiosk-login]');
  assert.equal(await page.inputValue('[data-kiosk-login] input[name="username"]'), `kiosk-${loginEvent.id}`);
  await page.fill('[data-kiosk-login] input[name="password"]', E2E_KIOSK_TOKEN);
  await page.click('[data-kiosk-login] button[type="submit"]');
  // The dashboard carries no header/brand chrome any more (a clean TV
  // display); the fullscreen corner control is the stable post-login anchor
  // instead — it only exists once ensureAccess() kept the real dashboard
  // markup rather than replacing it with the login form.
  await page.waitForSelector('#kiosk-fullscreen');

  // Regression test for the review finding on ensureAccess(): this kiosk is
  // set up once with ?token=... and then left running unattended for the
  // whole LAN, so a transient failure (network blip, timeout, a 5xx from the
  // server restarting mid-deploy) while re-checking access on reload must not
  // wipe an otherwise valid, persisted token — only a genuine 401 means the
  // credential itself is bad.
  const loginKioskToken = await page.evaluate(() => sessionStorage.getItem('respawn_kiosk_token'));
  assert.ok(loginKioskToken, 'kiosk login should have stored a token');
  const transientFailureRoute = (route: import('playwright').Route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Kiosk-Serverfehler (Test)' }) });
  await page.route('**/api/live', transientFailureRoute);
  try {
    await page.reload();
    await page.waitForSelector('[data-kiosk-login]');
  } finally {
    await page.unroute('**/api/live', transientFailureRoute);
  }
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem('respawn_kiosk_token')),
    loginKioskToken,
    'a transient failure while checking kiosk access must not clear the stored token',
  );

  const invalidTokenRoute = (route: import('playwright').Route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Nicht angemeldet.' }) });
  await page.route('**/api/live', invalidTokenRoute);
  try {
    await page.reload();
    await page.waitForSelector('[data-kiosk-login]');
  } finally {
    await page.unroute('**/api/live', invalidTokenRoute);
  }
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem('respawn_kiosk_token')),
    null,
    'a genuine 401 while checking kiosk access must clear the stale token',
  );

  await page.evaluate(() => sessionStorage.removeItem('respawn_kiosk_token'));
  assert.equal((await page.request.delete(`${BASE_URL}/api/events/${loginEvent.id}`)).status(), 200);

  await page.goto(`${BASE_URL}/kiosk.html?token=${E2E_KIOSK_TOKEN}`);
  await page.waitForSelector('#kiosk-fullscreen');
  assert.deepEqual(
    await page.locator('#kiosk-dashboard > .kiosk-card > div').evaluateAll((contents) => contents.map((content) => content.id)),
    ['kiosk-live', 'kiosk-newsticker', 'kiosk-votes', 'kiosk-tournament', 'kiosk-results'],
  );
  assert.equal(await page.locator('#kiosk-dashboard > .kiosk-card').count(), 4, 'results share the tournament tile');
  // Every agent report and offline sweep re-sends live:changed. A board that
  // did not change must leave Live-Status untouched: re-settling its layout
  // on each signal made the shared screen flicker and jump back to page one.
  const kioskLiveRefresh = () => page.waitForResponse((response) =>
    response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/live');
  const setOwnNote = async (note: string | null) => {
    const refreshed = kioskLiveRefresh();
    assert.equal((await page.request.post(`${BASE_URL}/api/live/${playerId}/note`, { data: { note } })).status(), 200);
    await refreshed;
  };
  await page.waitForSelector('#kiosk-live .kiosk-live-row');
  await setOwnNote('Kiosk-Pause');
  // The state is a dot that still names itself for assistive technology.
  await page.waitForSelector('#kiosk-live .kiosk-live-status.is-paused[aria-label="Pause"]');
  await page.locator('#kiosk-live').evaluate((live) => {
    const records: MutationRecord[] = [];
    new MutationObserver((batch) => records.push(...batch))
      .observe(live, { childList: true, subtree: true, attributes: true, characterData: true });
    (window as unknown as { kioskLiveMutations: MutationRecord[] }).kioskLiveMutations = records;
  });
  await setOwnNote('Kiosk-Pause');
  // The kiosk paints synchronously after its fetch resolves, and observer
  // records are delivered as microtasks; two animation frames therefore
  // order this read after any repaint the unchanged board could cause.
  const liveMutations = await page.evaluate(() => new Promise<number>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() =>
      resolve((window as unknown as { kioskLiveMutations: MutationRecord[] }).kioskLiveMutations.length)));
  }));
  assert.equal(liveMutations, 0, 'an unchanged live board must not repaint the Live-Status card');
  await setOwnNote(null);
  await page.waitForFunction(() => !document.querySelector('#kiosk-live .kiosk-live-status.is-paused'));

  // Running games: the board is rewritten in the route so the test controls
  // which games run without a Windows agent.
  type KioskLivePlayer = { player_id: string; name: string; state: string; games: unknown[]; activity_tracked?: boolean };
  let liveBoardEdit: ((board: KioskLivePlayer[]) => KioskLivePlayer[]) | null = null;
  const playing = (player: KioskLivePlayer, id: string, name: string, gameName: string): KioskLivePlayer => ({
    ...player,
    player_id: id,
    name,
    state: 'playing',
    activity_tracked: false,
    games: [{ game_id: `game-${gameName}`, game_name: gameName, game_icon: null, since: Date.now(), foreground: true }],
  });
  // While closed, further live requests wait in the route: a socket signal
  // from the server's own sweep must not repaint the card mid-check.
  let liveRequestGate: Promise<void> | null = null;
  let openLiveRequestGate = () => {};
  const closeLiveRequests = () => {
    liveRequestGate = new Promise((resolve) => { openLiveRequestGate = resolve; });
  };
  const openLiveRequests = () => {
    liveRequestGate = null;
    openLiveRequestGate();
  };
  const liveBoardRoute = async (route: import('playwright').Route) => {
    if (liveRequestGate) await liveRequestGate;
    const response = await route.fetch();
    const board = (await response.json()) as KioskLivePlayer[];
    await route.fulfill({ response, json: liveBoardEdit ? liveBoardEdit(board) : board });
  };
  await page.route('**/api/live', liveBoardRoute);
  try {
    // A board that is already on screen again must cancel a settle still
    // measuring an in-between board: holding animation frames parks the
    // settle for the short game board mid-measurement while the board
    // returns to the one the card shows. Counting the live bodies the page
    // has read orders the release after the kiosk handled that return: it
    // renders synchronously once apiFetch has the body.
    await page.evaluate(() => {
      const kiosk = window as unknown as { holdKioskFrames: () => void; releaseKioskFrames: () => void; kioskLiveBodies: number };
      kiosk.kioskLiveBodies = 0;
      const originalText = Response.prototype.text;
      Response.prototype.text = async function text(this: Response) {
        const body = await originalText.call(this);
        if (new URL(this.url).pathname === '/api/live') kiosk.kioskLiveBodies += 1;
        return body;
      };
      const held: FrameRequestCallback[] = [];
      const original = window.requestAnimationFrame.bind(window);
      kiosk.releaseKioskFrames = () => {
        window.requestAnimationFrame = original;
        held.splice(0).forEach((callback) => original(callback));
      };
      kiosk.holdKioskFrames = () => {
        window.requestAnimationFrame = (callback) => {
          held.push(callback);
          return 0;
        };
      };
    });
    const holdKioskFrames = () => page.evaluate(() => (window as unknown as { holdKioskFrames: () => void }).holdKioskFrames());
    const releaseKioskFrames = () => page.evaluate(() => (window as unknown as { releaseKioskFrames: () => void }).releaseKioskFrames());
    const kioskLiveProbes = (count: number) => page.waitForFunction(
      (expected) => document.querySelectorAll('#kiosk-live .kiosk-live-probe').length >= expected,
      count,
      { polling: 50 },
    );
    // Interval polling: the default frame-based polling would wait on the held frames.
    const kioskReadLiveBodies = (count: number) => page.waitForFunction(
      (expected) => (window as unknown as { kioskLiveBodies: number }).kioskLiveBodies >= expected,
      count,
      { polling: 50 },
    );
    await holdKioskFrames();
    liveBoardEdit = (board) => [...board, playing(board[0], 'kiosk-new-player', 'Neuer Spieler', 'Kiosk-Zwischenspiel')];
    await setOwnNote(null);
    await kioskReadLiveBodies(1);
    await page.waitForSelector('#kiosk-live .kiosk-live-probe', { state: 'attached' });
    liveBoardEdit = null;
    await setOwnNote(null);
    await kioskReadLiveBodies(2);
    closeLiveRequests();
    await releaseKioskFrames();
    // The probe leaves once the parked settle has finished; a stale paint
    // would follow in the same task, before the next poll reads the card.
    await page.waitForFunction(() => !document.querySelector('#kiosk-live .kiosk-live-probe'));
    assert.equal(await page.locator('#kiosk-live >> text=Neuer Spieler').count(), 0, 'an obsolete player row must not be painted');
    assert.equal(await page.locator('#kiosk-live-games > .kiosk-live-active').count(), 0);
    openLiveRequests();

    // A resize while a newer board is still being measured re-settles that
    // newer board, never the older one still on screen. Each resize starts a
    // settle of its own (one more parked probe), which orders the release
    // after both resize re-settles.
    const kioskViewport = page.viewportSize()!;
    await holdKioskFrames();
    liveBoardEdit = (board) => [...board, playing(board[0], 'kiosk-new-player', 'Neuer Spieler', 'Kiosk-Neues-Spiel')];
    await setOwnNote(null);
    await kioskReadLiveBodies(3);
    closeLiveRequests();
    await kioskLiveProbes(1);
    await page.setViewportSize({ width: kioskViewport.width - 120, height: kioskViewport.height });
    await kioskLiveProbes(2);
    await page.setViewportSize(kioskViewport);
    await kioskLiveProbes(3);
    await releaseKioskFrames();
    await page.waitForFunction(() => !document.querySelector('#kiosk-live .kiosk-live-probe'));
    assert.equal(
      await page.locator('#kiosk-live > .kiosk-live-grid >> text=Neuer Spieler').count(),
      1,
      'a resize must re-settle the newest board, not the one that was on screen',
    );
    await page.waitForSelector('#kiosk-live-games >> text=Kiosk-Neues-Spiel');
    assert.equal(await page.locator('#kiosk-live >> text=Kiosk-Neues-Spiel').count(), 0, 'game names appear only in the heading');
    openLiveRequests();

    // Many games on the 1280 px screen: the one-line strip keeps whole
    // name/count pairs and sums up the rest instead of shrinking every name.
    liveBoardEdit = (board) => [
      ...Array.from({ length: 8 }, (_, index) =>
        playing(board[0], `kiosk-game-player-${index}`, `Spieler ${index + 1}`, `Kiosk-Spiel mit langem Namen ${index + 1}`)),
      ...['online', 'paused', 'offline'].map((state) => ({
        ...board[0], player_id: `kiosk-status-${state}`, name: state, state, games: [],
      })),
    ];
    await setOwnNote(null);
    await page.waitForSelector('#kiosk-live > .kiosk-live-grid >> text=Spieler 1');
    const columnCount = await page.locator('#kiosk-live > .kiosk-live-grid').evaluate((grid) =>
      new Set(Array.from(grid.children, (row) => row.getBoundingClientRect().left)).size);
    assert.equal(columnCount, 4, 'the roster uses four columns when the card is wide enough');
    await page.emulateMedia({ forcedColors: 'active' });
    try {
      const markers = await page.locator('#kiosk-live > .kiosk-live-grid').evaluate((grid) =>
        ['playing', 'online', 'paused', 'offline'].map((state) => {
          const marker = grid.querySelector(`.kiosk-live-status.is-${state}`)!;
          const { backgroundColor, borderRadius, borderStyle, transform } = getComputedStyle(marker);
          return [backgroundColor, borderRadius, borderStyle, transform].join('|');
        }));
      assert.equal(new Set(markers).size, 4, 'all four status markers are visually distinct in forced colors');
    } finally {
      await page.emulateMedia({ forcedColors: null });
    }
    await page.waitForSelector('#kiosk-live-games > .kiosk-live-active .kiosk-live-more:not([hidden])');
    const strip = await page.locator('#kiosk-live-games > .kiosk-live-active').evaluate((element) => ({
      besideTitle: (() => {
        const title = element.closest('header')!.querySelector('h2')!.getBoundingClientRect();
        const games = element.getBoundingClientRect();
        return games.left >= title.right && games.top < title.bottom && games.bottom > title.top;
      })(),
      overflow: element.scrollWidth - element.clientWidth,
      more: element.querySelector('.kiosk-live-more')!.textContent,
      names: Array.from(element.querySelectorAll('.kiosk-live-game:not([hidden]) strong'), (name) => name.getBoundingClientRect().width),
      // Each shown pill holds its whole count and ends before the next one
      // starts, so no count is cut off or covered by a neighbour.
      counts: Array.from(element.querySelectorAll('.kiosk-live-game:not([hidden])')).map((pill, index, pills) => {
        const box = pill.getBoundingClientRect();
        const count = pill.querySelector('.kiosk-live-active-count')?.getBoundingClientRect() ?? box;
        const next = pills[index + 1]?.getBoundingClientRect();
        return count.right <= box.right + 0.5
          && box.right <= element.getBoundingClientRect().right + 0.5
          && (!next || box.right <= next.left + 0.5);
      }),
    }));
    assert.ok(strip.besideTitle, 'the game counts sit beside the Live-Status heading');
    assert.ok(strip.overflow <= 1, `the strip stays on one line inside the card: ${JSON.stringify(strip)}`);
    assert.match(strip.more ?? '', /^\+\d+$/);
    assert.match(
      (await page.locator('#kiosk-live-games > .kiosk-live-active .kiosk-live-more').getAttribute('aria-label')) ?? '',
      /^(1 weiteres Spiel|\d+ weitere Spiele)$/,
    );
    assert.ok(strip.names.length >= 1 && strip.names.every((width) => width >= 30), `every shown game keeps a readable name: ${JSON.stringify(strip)}`);
    assert.ok(strip.counts.every(Boolean), `no shown player count is cut off: ${JSON.stringify(strip)}`);
    assert.equal(Number(/\d+/.exec(strip.more ?? '')?.[0]) + strip.names.length, 8, 'shown and summed-up games add up to all running games');

    // The strip follows a change of groups even when every row reads the
    // same: two games "Portal" and "Portal 2" become one game whose name
    // holds a comma.
    const withGames = (player: KioskLivePlayer, names: string[]): KioskLivePlayer => ({
      ...playing(player, player.player_id, player.name, names[0]),
      games: names.map((name) => ({ game_id: `game-${name}`, game_name: name, game_icon: null, since: Date.now(), foreground: true })),
    });
    liveBoardEdit = (board) => [withGames(board[0], ['Portal', 'Portal 2'])];
    await setOwnNote(null);
    await page.waitForFunction(() => document.querySelectorAll('#kiosk-live-games > .kiosk-live-active .kiosk-live-game:not(.kiosk-live-more)').length === 2);
    await page.waitForFunction(() => document.querySelectorAll('#kiosk-live > .kiosk-live-grid .kiosk-live-row').length === 1);
    const stretchedRow = await page.locator('#kiosk-live > .kiosk-live-grid').evaluate((roster) => ({
      rowHeight: roster.querySelector('.kiosk-live-row')!.getBoundingClientRect().height,
      rosterHeight: roster.getBoundingClientRect().height,
    }));
    assert.ok(
      Math.abs(stretchedRow.rowHeight - stretchedRow.rosterHeight) <= 1,
      `a lone player row fills the available card height: ${JSON.stringify(stretchedRow)}`,
    );
    liveBoardEdit = (board) => [withGames(board[0], ['Portal, Portal 2'])];
    await setOwnNote(null);
    await page.waitForFunction(() => {
      const names = Array.from(document.querySelectorAll('#kiosk-live-games > .kiosk-live-active .kiosk-live-game:not(.kiosk-live-more) strong'), (name) => name.textContent);
      return names.length === 1 && names[0] === 'Portal, Portal 2';
    });

    // A largest game that fits on its own keeps its whole name, even when a
    // smaller group would need the "+N" pill next to it.
    const longGame = 'Die Siedler – Aufstieg';
    liveBoardEdit = (board) => [
      playing(board[0], 'kiosk-long-player-1', 'Spieler Siedler 1', longGame),
      playing(board[0], 'kiosk-long-player-2', 'Spieler Siedler 2', longGame),
      playing(board[0], 'kiosk-small-player', 'Spieler Factorio', 'Factorio mit vielen gleichzeitig aktiven Erweiterungen'),
    ];
    await setOwnNote(null);
    await page.waitForSelector('#kiosk-live > .kiosk-live-grid >> text=Spieler Factorio');
    await page.waitForSelector('#kiosk-live-games > .kiosk-live-active .kiosk-live-more:not([hidden])');
    const longName = await page.locator('#kiosk-live-games > .kiosk-live-active').evaluate((element) => {
      const name = element.querySelector('.kiosk-live-game strong')!;
      return { overflow: element.scrollWidth - element.clientWidth, cut: name.scrollWidth - name.clientWidth, text: name.textContent };
    });
    assert.ok(longName.overflow <= 1, `the strip stays on one line: ${JSON.stringify(longName)}`);
    assert.equal(longName.text, longGame);
    assert.ok(longName.cut <= 0, `a largest game that fits on its own is not shortened: ${JSON.stringify(longName)}`);

    // A largest game that fits on its own but not beside "+1" shortens its
    // name instead of dropping the label, so no running game goes uncounted.
    // The name is measured against this strip, which makes the case
    // independent of the fonts installed on the test machine.
    const tightGame = await page.locator('#kiosk-live-games > .kiosk-live-active').evaluate((strip) => {
      const pill = strip.querySelector('.kiosk-live-game')!;
      const name = pill.querySelector('strong')!;
      const more = strip.querySelector('.kiosk-live-more')!;
      const nameRoomAlone = strip.clientWidth - (pill.getBoundingClientRect().width - name.getBoundingClientRect().width);
      const nameRoomBesideMore = nameRoomAlone - parseFloat(getComputedStyle(strip).columnGap) - more.getBoundingClientRect().width;
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = getComputedStyle(name).font;
      let text = 'Kiosk-Spiel';
      while (context.measureText(text).width < (nameRoomAlone + nameRoomBesideMore) / 2) text += 'x';
      return text;
    });
    liveBoardEdit = (board) => [
      playing(board[0], 'kiosk-tight-player-1', 'Spieler Knapp 1', tightGame),
      playing(board[0], 'kiosk-tight-player-2', 'Spieler Knapp 2', tightGame),
      playing(board[0], 'kiosk-tight-small', 'Spieler Klein Knapp', 'Factorio'),
    ];
    await setOwnNote(null);
    await page.waitForSelector('#kiosk-live > .kiosk-live-grid >> text=Spieler Klein Knapp');
    const tight = await page.locator('#kiosk-live-games > .kiosk-live-active').evaluate((element) => {
      const name = element.querySelector('.kiosk-live-game strong')!;
      return {
        overflow: element.scrollWidth - element.clientWidth,
        more: element.querySelector('.kiosk-live-more:not([hidden])')?.textContent ?? null,
        cut: name.scrollWidth - name.clientWidth,
        readable: name.getBoundingClientRect().width >= parseFloat(getComputedStyle(name).fontSize) * 3,
      };
    });
    assert.deepEqual(
      { fits: tight.overflow <= 1, more: tight.more, shortened: tight.cut > 0, readable: tight.readable },
      { fits: true, more: '+1', shortened: true, readable: true },
      JSON.stringify({ tightGame, ...tight }),
    );

    // A single game whose name alone is wider than the strip shortens only
    // its name, never to nothing, also beside a smaller group; its count
    // stays whole inside the card.
    const overlongGame = `Kiosk-Spiel ${'mit sehr langem Namen '.repeat(6)}`.trim();
    liveBoardEdit = (board) => [
      playing(board[0], 'kiosk-overlong-player', 'Spieler Lang', overlongGame),
      playing(board[0], 'kiosk-overlong-player-2', 'Spieler Lang 2', overlongGame),
      playing(board[0], 'kiosk-overlong-small', 'Spieler Klein', 'Factorio'),
    ];
    await setOwnNote(null);
    // Wait for the new board before measuring its strip.
    await page.waitForSelector('#kiosk-live > .kiosk-live-grid >> text=Spieler Lang');
    await page.waitForSelector('#kiosk-live-games > .kiosk-live-active .kiosk-live-game.is-squeezed');
    const squeezed = await page.locator('#kiosk-live-games > .kiosk-live-active').evaluate((element) => {
      const right = element.getBoundingClientRect().right;
      const name = element.querySelector('.kiosk-live-game strong')!;
      return {
        overflow: element.scrollWidth - element.clientWidth,
        name: name.getBoundingClientRect().width,
        minimum: parseFloat(getComputedStyle(name).fontSize) * 3,
        countInside: element.querySelector('.kiosk-live-active-count')!.getBoundingClientRect().right <= right + 0.5,
      };
    });
    assert.deepEqual(
      { fits: squeezed.overflow <= 1, readableName: squeezed.name >= squeezed.minimum, countInside: squeezed.countInside },
      { fits: true, readableName: true, countInside: true },
      JSON.stringify(squeezed),
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const strip = document.querySelector<HTMLElement>('#kiosk-live-games > .kiosk-live-active')!;
      const title = strip.closest('header')!.querySelector('h2')!.getBoundingClientRect();
      const count = strip.querySelector('.kiosk-live-active-count')!.getBoundingClientRect();
      const bounds = strip.getBoundingClientRect();
      const rows = document.querySelectorAll('#kiosk-live > .kiosk-live-grid .kiosk-live-row');
      return bounds.top >= title.bottom && count.right <= bounds.right + 0.5
        && strip.scrollWidth <= strip.clientWidth + 1
        && new Set(Array.from(rows, (row) => row.getBoundingClientRect().left)).size === 1;
    });
  } finally {
    openLiveRequests();
    await page.unroute('**/api/live', liveBoardRoute);
    await page.evaluate(() => (window as unknown as { releaseKioskFrames?: () => void }).releaseKioskFrames?.());
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await setOwnNote(null);
  await page.waitForFunction(() => !document.querySelector('#kiosk-live-games > .kiosk-live-active'));
  // The newsticker opens with a few generated lines: one lead headline with
  // its kicker, all of them fitted inside the tile.
  await page.waitForSelector('#kiosk-newsticker .kiosk-news-item.is-first .kiosk-news-kicker >> text=Eilmeldung');
  const newsBounds = await page.locator('#kiosk-newsticker').evaluate((tile) => {
    const bottom = tile.getBoundingClientRect().bottom;
    const items = Array.from(tile.querySelectorAll('.kiosk-news-item'));
    return { count: items.length, fits: items.every((item) => item.getBoundingClientRect().bottom <= bottom + 0.5) };
  });
  assert.ok(newsBounds.count >= 2 && newsBounds.count <= 7, `the newsticker shows two to seven lines: ${JSON.stringify(newsBounds)}`);
  assert.equal(newsBounds.fits, true, 'no newsticker line reaches past the tile');

  // The last-push banner shows the food order's own push (title "Neue
  // Sammelbestellung"), not the earlier Durchsage — with a timestamp, and
  // it stays up permanently rather than auto-hiding after a few minutes.
  await page.waitForSelector('#kiosk-broadcast:not([hidden]) >> text=Neue Sammelbestellung');
  await page.waitForSelector('#kiosk-broadcast >> text=Kiosk-Test-Pizza');
  await page.waitForSelector('.kiosk-broadcast-time');
  assert.match(
    (await page.locator('.kiosk-broadcast-time').textContent()) ?? '',
    /^(gerade eben|vor \d+ Min\.)$/,
    'a fresh banner shows its age instead of a second clock time',
  );
  await page.waitForSelector('.notification-banner-body');
  assert.match((await page.locator('#kiosk-clock').textContent()) ?? '', /\d{2}:\d{2}/, 'the header shows a running clock');
  const bannerLine = await page.locator('#kiosk-broadcast').evaluate((banner) => {
    const title = banner.querySelector('.notification-banner-text strong')!.getClientRects()[0];
    const body = banner.querySelector('.notification-banner-body')!.getClientRects()[0];
    return { titleTop: title.top, bodyTop: body.top };
  });
  assert.ok(Math.abs(bannerLine.titleTop - bannerLine.bodyTop) <= 4, `banner title and body share one line: ${JSON.stringify(bannerLine)}`);
  await page.click('#kiosk-fullscreen');
  await page.waitForSelector('#kiosk-fullscreen[aria-pressed="true"]');
  await page.click('#kiosk-fullscreen');
  await page.waitForSelector('#kiosk-fullscreen[aria-pressed="false"]');

  await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId, message: 'Kiosk-Live-Durchsage alt' },
  });
  await page.waitForSelector('#kiosk-broadcast >> text=Kiosk-Live-Durchsage alt');
  await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId, message: 'Kiosk-Live-Durchsage neu' },
  });
  await page.waitForSelector('#kiosk-broadcast >> text=Kiosk-Live-Durchsage neu');
  assert.equal(await page.locator('#kiosk-broadcast >> text=Kiosk-Live-Durchsage alt').count(), 0);
  await page.waitForSelector('.kiosk-vote-overview >> text=Stichwahl läuft');
  assert.equal(await page.locator('.kiosk-vote-overview >> text=Zwischenstand').count(), 0);
  await page.waitForFunction(() => {
    const text = document.querySelector('.kiosk-vote-header .badge')?.textContent ?? '';
    return /^1 \/ \d+ abgestimmt$/.test(text.trim());
  });
  // Query and read in one synchronous page step: the vote card repaints its
  // content when the dashboard height changes (banner or Jam bar appearing),
  // and a header detached between locating and reading reports no style.
  assert.equal(await page.evaluate(() => {
    const header = document.querySelector('.kiosk-vote-header');
    return header ? getComputedStyle(header).alignItems : null;
  }), 'center');
  await page.waitForSelector('.kiosk-vote-result.is-concealed >> text=1 Stimme');
  assert.equal(await page.locator(`.kiosk-vote-result:has-text("${games[1].name}")`).count(), 0);
  assert.notEqual(await page.locator('.kiosk-vote-result.is-concealed strong').evaluate((element) => getComputedStyle(element).filter), 'none');
  assert.equal(await page.getByText('Ergebnis erst nach dem Ende.', { exact: false }).count(), 0);
  await page.waitForSelector('.kiosk-match-grid .kiosk-match-card');
  await page.locator('#kiosk-broadcast').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  assert.equal(await page.locator('#kiosk-alerts > *').count(), 1);
  const [alertBox, bannerBox] = await Promise.all([
    page.locator('#kiosk-alerts').boundingBox(),
    page.locator('#kiosk-broadcast').boundingBox(),
  ]);
  assert.ok(
    alertBox && bannerBox && Math.abs(alertBox.width - bannerBox.width) <= 1,
    `highlighted message should fill the alert row (${JSON.stringify({ alertBox, bannerBox })})`
  );
  const [tournamentBox, metaBox, bracketBodyBox, matchGridBox] = await Promise.all([
    page.locator('#kiosk-tournament').boundingBox(),
    page.locator('.kiosk-tournament-meta').boundingBox(),
    page.locator('.kiosk-tournament-bracket-body').boundingBox(),
    page.locator('.kiosk-match-grid').boundingBox(),
  ]);
  assert.ok(
    tournamentBox && metaBox && Math.abs(tournamentBox.y - metaBox.y) < 4,
    'tournament game and round should remain at the top of the card content area'
  );
  // Top-aligned, not centered: a bracket body that overflows (many stacked
  // matches on a short kiosk screen) must clip at the bottom instead of
  // spilling upward into the round metadata above it.
  assert.ok(
    bracketBodyBox && matchGridBox && Math.abs(bracketBodyBox.y - matchGridBox.y) < 4,
    'tournament bracket should sit at the top of its bracket body'
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.body.scrollHeight <= window.innerHeight),
    true,
    'kiosk page must fit without page scrollbars'
  );
  assert.equal(
    await page.locator('.kiosk-card > div').evaluateAll((elements) => elements.every((element) => getComputedStyle(element).overflowY !== 'auto' && getComputedStyle(element).overflowY !== 'scroll')),
    true,
    'kiosk cards must not introduce internal scrollbars'
  );
  // Reconnect is a cache-recovery boundary: changes made while the display
  // was offline must appear immediately after Socket.IO reconnects, without
  // waiting for another domain event or the periodic safety refresh.
  await page.context().setOffline(true);
  await page.waitForTimeout(250);
  const offlineCancel = await fetch(`${BASE_URL}/api/votes/cancel`, {
    method: 'POST',
    headers: { cookie: adminCookie },
  });
  assert.equal(offlineCancel.status, 200, await offlineCancel.clone().text());
  const offlineStart = await fetch(`${BASE_URL}/api/votes/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ mode: 'single', title: 'Kiosk nach Reconnect', gameIds: [games[0].id, games[1].id] }),
  });
  assert.equal(offlineStart.status, 201, await offlineStart.clone().text());
  await page.context().setOffline(false);
  await page.waitForSelector('.kiosk-vote-overview >> text=Kiosk nach Reconnect', { timeout: 10_000 });
  await page.request.post(`${BASE_URL}/api/votes/cancel`);
  const kioskGames = games.slice(0, 10) as Array<{ id: string }>;
  const largeVoteStart = await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'points', title: 'Großer Kiosk Vote', gameIds: kioskGames.map((game) => game.id) },
  });
  const largeVoteRound = (await largeVoteStart.json()).round as number;
  await page.request.post(`${BASE_URL}/api/votes/points`, {
    data: {
      playerId,
      // 0-5 points: one clear winner, every game scored. The kiosk shows as
      // many of these ten as fit the card at the normal row size.
      entries: kioskGames.map((game, index) => ({ gameId: game.id, points: index === 0 ? 5 : Math.max(1, 4 - Math.floor((index - 1) / 2)) })),
    },
  });
  // API writes can finish before the socket update replaces the previous
  // runoff's rows. Wait for this round and its submitted points first.
  await page.waitForSelector('.kiosk-vote-overview >> text=Großer Kiosk Vote');
  await page.waitForSelector('.kiosk-vote-result.is-concealed >> text=5 P');
  const shownVoteRows = await page.locator('.kiosk-vote-result').count();
  assert.equal(await page.locator('.kiosk-vote-result.is-concealed').count(), shownVoteRows);
  assert.ok(await page.locator('.kiosk-vote-result.is-concealed strong').evaluateAll((names) => {
    const lengths = names.map((name) => name.textContent?.length ?? 0);
    return new Set(lengths).size > 1;
  }), 'concealed game labels should use varying character counts');
  const voteBounds = await page.locator('#kiosk-votes').evaluate((voteContent) => {
    const contentBox = voteContent.getBoundingClientRect();
    const resultBoxes = Array.from(voteContent.querySelectorAll('.kiosk-vote-result')).map((result) => {
      const resultBox = result.getBoundingClientRect();
      return { top: resultBox.top, bottom: resultBox.bottom };
    });
    return {
      content: { top: contentBox.top, bottom: contentBox.bottom },
      results: resultBoxes,
      allVisible: resultBoxes.every((result) => result.top >= contentBox.top && result.bottom <= contentBox.bottom),
    };
  });
  assert.equal(voteBounds.allVisible, true, `the shown vote results should remain visible inside the kiosk card: ${JSON.stringify(voteBounds)}`);
  const voteRowHeights = voteBounds.results.map((result) => result.bottom - result.top);
  assert.ok(Math.max(...voteRowHeights) - Math.min(...voteRowHeights) <= 1, `vote rows keep one row size: ${voteRowHeights}`);
  if (shownVoteRows < kioskGames.length) {
    const lastBottom = voteBounds.results[voteBounds.results.length - 1].bottom;
    assert.ok(
      voteBounds.content.bottom - lastBottom < 2 * voteRowHeights[0],
      `the vote card fills its free height before hiding further rows: ${JSON.stringify(voteBounds)}`,
    );
  }
  const parallelVoteStart = await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'points', title: 'Parallel auf dem Kiosk', gameIds: [games[0].id] },
  });
  const parallelVoteRound = (await parallelVoteStart.json()).round as number;
  await page.request.post(`${BASE_URL}/api/votes/close`, { data: { round: largeVoteRound } });
  await page.waitForSelector('.kiosk-vote-countdown >> text=Ergebnis in');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-num-fill').textContent(), '5');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-num-glow').textContent(), '5');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-pop').count(), 1);
  assert.equal(await page.locator('.kiosk-vote-result').count(), 0);
  await page.waitForSelector('.kiosk-vote-final >> text=Ergebnis im Detail', { timeout: 7_000 });
  assert.ok(
    await page.locator('#kiosk-votes').evaluate((voteContent) => {
      const bottom = voteContent.getBoundingClientRect().bottom;
      const rows = Array.from(voteContent.querySelectorAll('.kiosk-vote-final .kiosk-vote-result'));
      return rows.length > 0 && rows.every((row) => row.getBoundingClientRect().bottom <= bottom + 0.5);
    }),
    'the revealed result is fitted to the card like the running vote',
  );
  assert.equal(await page.locator('.kiosk-vote-final .kiosk-vote-result.is-concealed').count(), 0);
  assert.equal(await page.locator('.kiosk-vote-final .kiosk-vote-result.is-leading').count(), 0);
  assert.deepEqual(await page.locator('.kiosk-vote-final-title').allTextContents(), ['Gewinner', 'Ergebnis im Detail']);
  assert.equal(
    await page.locator('.kiosk-vote-final-title').evaluateAll((titles) => titles.every((title) => getComputedStyle(title).fontSize === getComputedStyle(titles[0]).fontSize)),
    true,
  );
  await page.waitForSelector(`.kiosk-vote-winner:has-text("${games[0].name}")`);
  assert.equal(await page.locator('.kiosk-vote-final > :first-child').getAttribute('class'), 'kiosk-vote-winner-section');
  assert.ok((await page.locator('.kiosk-vote-winner').evaluate((winner) => getComputedStyle(winner).backgroundImage)).includes('linear-gradient'));
  await page.waitForSelector(`.kiosk-vote-final .kiosk-vote-result:has-text("${games[0].name}")`);
  assert.ok(await page.locator('.kiosk-vote-final').evaluate((result) => {
    const resultBox = result.getBoundingClientRect();
    const contentBox = result.parentElement!.getBoundingClientRect();
    return Math.abs(resultBox.top - contentBox.top) < 2;
  }));
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.equal(await page.locator('#kiosk-votes').evaluate((voteContent) => {
    const contentBox = voteContent.getBoundingClientRect();
    return Array.from(voteContent.querySelectorAll('.kiosk-vote-winner, .kiosk-vote-result')).every((element) => {
      const box = element.getBoundingClientRect();
      return box.top >= contentBox.top && box.bottom <= contentBox.bottom;
    });
  }), true, 'winner and the fixed Top 5 detailed results should remain visible at 720p');
  await page.waitForSelector('.kiosk-vote-overview >> text=Parallel auf dem Kiosk', { timeout: 25_000 });
  await page.request.post(`${BASE_URL}/api/votes/cancel`, { data: { round: parallelVoteRound } });
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'single', title: 'Kiosk Ergebnis ausblenden', gameIds: [games[0].id] },
  });
  await page.waitForSelector('.kiosk-vote-overview >> text=Stichwahl läuft');
  await page.request.post(`${BASE_URL}/api/votes/cancel`);
  await page.waitForSelector('#kiosk-votes >> text=Noch keine Abstimmung.');
  assert.equal(await page.locator('.kiosk-vote-overview').count(), 0);
  assert.ok(await page.locator('#kiosk-votes .kiosk-vote-state').evaluate((emptyState) => {
    const emptyBox = emptyState.getBoundingClientRect();
    const contentBox = emptyState.parentElement!.getBoundingClientRect();
    return Math.abs(emptyBox.y + emptyBox.height / 2 - (contentBox.y + contentBox.height / 2)) < 2;
  }));
  await page.setViewportSize({ width: 390, height: 844 });
});
