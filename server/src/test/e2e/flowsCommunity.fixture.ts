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
  bob,
  openMatchmakingHistory,
  openTeams,
  openOrgaTab,
  switchIdentityAndOpenArrivals,
  createAccountForFlow,
} from './flowsShared.fixture';

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
  // topmost dialog, not the whole stack underneath it.
  await page.click('[data-delete-entry]');
  await page.waitForSelector('[data-confirm]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-confirm]', { state: 'detached' });
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

  // The dialog stays open over the current view until it is dismissed.
  assert.equal(await page.locator('.info-board-modal').count(), 1);
  await page.click('.info-board-modal [data-close]');
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

flowTest('Info: a long entry scrolls within a bounded box instead of collapsing', async () => {
  await page.click('#info-btn');
  await page.waitForSelector('#info-new-btn');

  // A short entry (well under the scroll threshold) renders in full, with no
  // bounded scroll box at all.
  await page.click('#info-new-btn');
  await page.fill('#info-title', 'Discord');
  await page.fill('#info-content', 'discord.gg/example');
  await page.click('#info-form button[type="submit"]');
  await page.waitForSelector('text=discord.gg/example');
  const discordEntry = page.locator('[data-info-entry]', { hasText: 'Discord' });
  assert.equal(await discordEntry.locator('.info-board-content-scroll').count(), 0);

  // A long entry stays fully visible - no toggle, nothing hidden - but
  // scrolls within a bounded box instead of stretching its card (and its
  // short neighbor) to match its full height.
  const longContent = Array.from({ length: 6 }, (_, i) => `Regel ${i + 1}: Sei nett zueinander.`).join('\n');
  await page.click('#info-new-btn');
  await page.fill('#info-title', 'Hausregeln');
  await page.fill('#info-content', longContent);
  await page.click('#info-form button[type="submit"]');
  const rulesEntry = page.locator('[data-info-entry]', { hasText: 'Hausregeln' });
  const scrollBox = rulesEntry.locator('.info-board-content-scroll');
  await scrollBox.waitFor();
  assert.equal(await rulesEntry.getByText('Regel 6: Sei nett zueinander.').isVisible(), true);
  // The box is actually bounded rather than merely tall enough to fit
  // everything - otherwise the scroll container would be pointless.
  const isBounded = await scrollBox.evaluate((el) => el.scrollHeight > el.clientHeight);
  assert.equal(isBounded, true);

  await page.click('.info-board-modal [data-close]');
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
  // The driver only ever gets Bearbeiten/Löschen, never a "Raus" button.
  await page.waitForSelector('[data-edit-carpool]');
  await page.waitForSelector('[data-remove-carpool]');
  assert.equal(await page.locator('[data-leave-carpool]').count(), 0);

  // Switch identity to Bob: he joins, taking the last seat.
  await switchIdentityAndOpenArrivals('E2E Bob');
  await page.waitForSelector('[data-join-carpool]');
  await page.click('[data-join-carpool]');
  await page.waitForSelector('.arrivals-free-seat-row', { state: 'detached' });
  await page.waitForSelector('[data-leave-carpool]');

  // "Alle Zeiten" below shows who Bob is riding with.
  const bobTimesRow = page.locator('.arrivals-times-row', { hasText: 'E2E Bob' });
  await bobTimesRow.waitFor();
  assert.match((await bobTimesRow.textContent()) ?? '', /Fahrer: E2E Alice Pro/);

  // A third player finds the carpool full and can't join.
  await switchIdentityAndOpenArrivals('E2E Carol');
  await page.waitForSelector('.arrivals-member-row:has-text("E2E Bob"):has-text("Mitfahrer")');
  assert.equal(await page.locator('.arrivals-free-seat-row').count(), 0);
  assert.equal(await page.locator('[data-join-carpool]').count(), 0);

  // Bob leaves, freeing the seat back up; the driver deletes the group.
  await switchIdentityAndOpenArrivals('E2E Bob');
  await page.click('[data-leave-carpool]');
  await page.waitForSelector('.arrivals-free-seat-row');
  assert.doesNotMatch((await bobTimesRow.textContent()) ?? '', /Fahrer:/);

  await switchIdentityAndOpenArrivals('E2E Alice Pro');
  await page.click('[data-remove-carpool]');
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
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  // The carpool must still exist - Enter cancelled instead of confirming.
  await page.waitForSelector('[data-remove-carpool]');

  // Deleting for real still works through an explicit confirm click.
  await page.click('[data-remove-carpool]');
  await page.click('[data-confirm]');
  await page.waitForSelector('text=Noch keine Fahrgemeinschaft.');
});

flowTest(
  'An- & Abreise: an unrelated Orga To-Do keeps the unsaved Ankunft/Abreise draft and focus',
  async () => {
    // Regression for the area shell: checklist:changed now re-renders every
    // Orga tab (see app.js), not only the Checkliste's own, so that the
    // To-Dos tab's live count stays correct everywhere. An unrelated To-Do
    // assigned to Alice by someone else must not throw away what she is
    // still typing into "Meine An-/Abreise" on a different Orga tab.
    await switchIdentityAndOpenArrivals('E2E Alice Pro');

    const note = page.locator('#arrival-note');
    await note.click();
    await note.fill('Bringe Verlängerungskabel mit');

    const badge = page.locator('[data-section-tab="checklist"] [data-section-tab-count]');
    const before = (await badge.textContent()) ?? '';

    // Playwright's page.request shares the browser context's cookie jar. An
    // authenticated response renews its session cookie, so using Bob's
    // explicit Cookie header there can silently switch the page itself to
    // Bob once a racing response settles. Node fetch is intentionally
    // isolated from that jar while the open Alice page receives the socket
    // update this scenario needs.
    const created = await fetch(`${BASE_URL}/api/checklist/tasks/todo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: bob.cookie },
      body: JSON.stringify({ playerId: bob.id, title: 'Kabeltrommel besorgen', assigneePlayerIds: [alice.id] }),
    });
    assert.equal(created.status, 201, await created.text());
    // The changed tab count is the visible proof that the unrelated event's
    // re-render actually landed on this tab, not just that nothing happened.
    await page.waitForFunction(
      ({ selector, previous }) => document.querySelector(selector)?.textContent !== previous,
      { selector: '[data-section-tab="checklist"] [data-section-tab-count]', previous: before }
    );

    assert.equal(await note.inputValue(), 'Bringe Verlängerungskabel mit');
    assert.equal(
      await page.evaluate(() => document.activeElement?.id === 'arrival-note'),
      true,
      'focus must stay in the Notiz field across a background Orga re-render'
    );

    // Saving afterwards still works, so the surviving node is the live one.
    await page.click('#arrival-form button[type="submit"]');
    await page.waitForSelector('text=An-/Abreise gespeichert.');

    // The assignment above sent Alice a personal, still-unread push
    // notification ("Dir wurde eine Aufgabe zugewiesen") - the same
    // getCurrentPushLogEntryFor() query the header highlight banner uses
    // would otherwise keep surfacing it as the *next* highlighted entry the
    // moment a later test's own notification gets dismissed, since it
    // orders by creation time and this one is now the oldest unseen. Clear
    // it so it does not leak into the "Durchsage" test's
    // #notification-highlight assertions right after this one.
    const cleared = await fetch(`${BASE_URL}/api/push/seen-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ playerId: alice.id }),
    });
    assert.equal(cleared.status, 200, await cleared.text());
  }
);

flowTest('Durchsage: notification center can navigate, mark read and remove without duplicating Home', async () => {
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="broadcast"]');
  await page.waitForSelector('#broadcast-message');
  const defaultEndsAt = new Date(await page.inputValue('#broadcast-ends-at')).getTime();
  assert.ok(defaultEndsAt >= Date.now() + 55 * 60 * 1000);
  assert.ok(defaultEndsAt <= Date.now() + 65 * 60 * 1000);
  await page.fill('#broadcast-message', 'Essen ist da!');
  await page.click('#broadcast-form button[type="submit"]');
  // Wait for the durable signal (the entry in "Letzte Durchsagen"), not the
  // 2.6s confirmation toast — too short-lived to assert on reliably.
  try {
    await page.click('details[data-broadcast-history] summary');
    await page.waitForSelector('.lb-row >> text=Essen ist da!', { timeout: 8000 });
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
  await page.waitForSelector('.lb-row >> text=Essen ist da!');

  // Home no longer renders a second notification history in a different
  // style; notifications live only under the bell.
  await page.click('.nav-btn[data-view="home"]');
  assert.equal(await page.locator('.section-title:has-text("Mitteilungen")').count(), 0);

  // A second message can be ended early by its creator; it remains a past
  // notification until this player removes it from the center.
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="broadcast"]');
  await page.fill('#broadcast-message', 'Turnier startet gleich!');
  await page.click('#broadcast-form button[type="submit"]');
  const activeRow = page.locator('.lb-row:has-text("Turnier startet gleich!")');
  await activeRow.waitFor();
  await activeRow.locator('[data-end-broadcast]').click();
  await activeRow.locator('text=Beendet am').waitFor();
  await page.click('#notifications-btn');
  const endedNotification = page.locator('.notification-center-entry:has-text("Turnier startet gleich!")');
  await endedNotification.waitFor();
  // Ending the broadcast before anyone opened this notification resolves it
  // server-side (resolvePushTopic in routes/broadcasts.ts): the center shows
  // it as already settled rather than as something still needing attention,
  // even though it was never explicitly marked read.
  await endedNotification.locator('text=Obsolet').waitFor();
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
  // panel is guaranteed empty for the next flow, regardless of what "Obsolete
  // aufräumen" already removed above.
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
  await page.waitForSelector('[data-record-draw]');
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

flowTest('Aktuell: an open vote can be dismissed without hiding the next round', async (t) => {
  t.after(async () => page.setViewportSize({ width: 390, height: 844 }));
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-title');
  await page.fill('#votes-title', 'Freitagabend-Runde');
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close'); // only rendered once ctx.refresh() shows the round as open

  // This shard deliberately has no earlier vote lifecycle that happens to
  // warm the shared app state. Rehydrate once from the server so the Home
  // assertion proves persisted state instead of relying on test order.
  const openedVote = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
  assert.equal(openedVote.title, 'Freitagabend-Runde');
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');

  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('section.grouped-page-section:has(h2:text-is("Aktuell"))');
  const currentVote = page.locator(`[data-current-item="vote:${openedVote.round}"]`);
  await currentVote.waitFor();
  const dismissButton = currentVote.locator('[data-dismiss-current]');
  assert.equal(await dismissButton.getAttribute('aria-label'), 'Freitagabend-Runde ausblenden');
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-current-item] [data-dismiss-current]')?.getBoundingClientRect();
    return Boolean(box && box.width >= 44 && box.height >= 44);
  });
  const mobileDismissBox = await dismissButton.boundingBox();
  assert.ok(mobileDismissBox && mobileDismissBox.width >= 44 && mobileDismissBox.height >= 44);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.setViewportSize({ width: 900, height: 844 });
  await currentVote.waitFor();
  assert.ok(await dismissButton.isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  await dismissButton.focus();
  await page.keyboard.press('Enter');
  await currentVote.waitFor({ state: 'detached' });

  // The personal dismissal survives a reload, just like removing an entry
  // from Mitteilungen, without closing the shared vote itself.
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.click('.nav-btn[data-view="home"]');
  assert.equal(await page.locator(`[data-current-item="vote:${openedVote.round}"]`).count(), 0);
  assert.equal((await (await page.request.get(`${BASE_URL}/api/votes`)).json()).open, true);

  // A later lifecycle gets a new stable id and must be visible again.
  await page.click('.nav-btn[data-view="votes"]');
  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
  await page.fill('#votes-title', 'Samstagabend-Runde');
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close');
  const nextVote = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
  assert.notEqual(nextVote.round, openedVote.round);
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector(`[data-current-item="vote:${nextVote.round}"]:has-text("Samstagabend-Runde")`);

  // Leave no open round behind for later tests.
  await page.click('.nav-btn[data-view="votes"]');
  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
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
    data: { playerId, entries: [{ gameId: games[0].id, points: 8 }, { gameId: games[1].id, points: 5 }] },
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
  await page.waitForSelector('.kiosk-header .brand-title');

  // Regression test for the review finding on ensureAccess(): this kiosk is
  // set up once with ?token=... and then left running unattended for the
  // whole LAN, so a transient failure (network blip, timeout, a 5xx from the
  // server restarting mid-deploy) while re-checking access on reload must not
  // wipe an otherwise valid, persisted token — only a genuine 401 means the
  // credential itself is bad.
  const loginKioskToken = await page.evaluate(() => localStorage.getItem('respawn_kiosk_token'));
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
    await page.evaluate(() => localStorage.getItem('respawn_kiosk_token')),
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
    await page.evaluate(() => localStorage.getItem('respawn_kiosk_token')),
    '',
    'a genuine 401 while checking kiosk access must clear the stale token',
  );

  await page.evaluate(() => localStorage.removeItem('respawn_kiosk_token'));
  assert.equal((await page.request.delete(`${BASE_URL}/api/events/${loginEvent.id}`)).status(), 200);

  await page.goto(`${BASE_URL}/kiosk.html?token=${E2E_KIOSK_TOKEN}`);
  assert.equal((await page.locator('.kiosk-header .brand-title').textContent())?.trim(), 'Respawn');
  assert.deepEqual(
    await page.locator('#kiosk-dashboard > .kiosk-card > div').evaluateAll((contents) => contents.map((content) => content.id)),
    ['kiosk-live', 'kiosk-leaderboard', 'kiosk-votes', 'kiosk-tournament'],
  );

  // The last-push banner shows the food order's own push (title "Neue
  // Sammelbestellung"), not the earlier Durchsage — with a timestamp, and
  // it stays up permanently rather than auto-hiding after a few minutes.
  await page.waitForSelector('#kiosk-broadcast:not([hidden]) >> text=Neue Sammelbestellung');
  await page.waitForSelector('#kiosk-broadcast >> text=Kiosk-Test-Pizza');
  await page.waitForSelector('.kiosk-broadcast-time');
  await page.waitForSelector('.notification-banner-body');
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
  await page.waitForSelector('.kiosk-vote-overview >> text=Zwischenstand');
  await page.waitForFunction(() => {
    const text = document.querySelector('.kiosk-vote-header .badge')?.textContent ?? '';
    return /^1 \/ \d+ abgestimmt$/.test(text.trim());
  });
  assert.equal(await page.locator('.kiosk-vote-results.is-compact').count(), 1);
  assert.equal(await page.locator('.kiosk-vote-results.is-compact').evaluate((element) => getComputedStyle(element).flexGrow), '0');
  assert.equal(await page.locator('.kiosk-vote-header').evaluate((element) => getComputedStyle(element).alignItems), 'center');
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
  assert.ok(
    bracketBodyBox && matchGridBox && Math.abs(bracketBodyBox.y + bracketBodyBox.height / 2 - (matchGridBox.y + matchGridBox.height / 2)) < 4,
    'tournament bracket should be vertically centered below its metadata'
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
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'points', title: 'Großer Kiosk Vote', gameIds: kioskGames.map((game) => game.id) },
  });
  await page.request.post(`${BASE_URL}/api/votes/points`, {
    data: {
      playerId,
      entries: kioskGames.map((game, index) => ({ gameId: game.id, points: 10 - index })),
    },
  });
  await page.waitForSelector('.kiosk-vote-result:nth-child(10)');
  assert.equal(await page.locator('.kiosk-vote-result').count(), 10);
  assert.equal(await page.locator('.kiosk-vote-result.is-concealed').count(), 10);
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
  assert.equal(voteBounds.allVisible, true, `ten live vote results should remain visible inside the kiosk card: ${JSON.stringify(voteBounds)}`);
  assert.ok(await page.locator('.kiosk-vote-results').evaluate((results) => {
    const resultBox = results.getBoundingClientRect();
    const parentBox = results.parentElement!.getBoundingClientRect();
    return Math.abs(resultBox.bottom - parentBox.bottom) < 2;
  }), 'live vote results should use the remaining card height');
  const compactVoteRowHeight = (await page.locator('.kiosk-vote-result').first().boundingBox())!.height;
  await page.setViewportSize({ width: 1280, height: 1080 });
  const tallVoteRowHeight = (await page.locator('.kiosk-vote-result').first().boundingBox())!.height;
  assert.ok(tallVoteRowHeight > compactVoteRowHeight * 2, 'tall kiosk cards should distribute their free height across vote rows');
  await page.request.post(`${BASE_URL}/api/votes/close`);
  await page.waitForSelector('.kiosk-vote-countdown >> text=Ergebnis in');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-num-fill').textContent(), '5');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-num-glow').textContent(), '5');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-pop').count(), 1);
  assert.equal(await page.locator('.kiosk-vote-result').count(), 0);
  await page.waitForSelector('.kiosk-vote-final >> text=Ergebnis im Detail', { timeout: 7_000 });
  assert.equal(await page.locator('.kiosk-vote-final .kiosk-vote-result').count(), 10);
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
  }), true, 'winner and ten detailed results should remain visible at 720p');
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'single', title: 'Kiosk Ergebnis ausblenden', gameIds: [games[0].id] },
  });
  await page.waitForSelector('.kiosk-vote-overview >> text=Stichwahl läuft');
  await page.request.post(`${BASE_URL}/api/votes/cancel`);
  await page.waitForSelector('#kiosk-votes >> text=Keine offene Abstimmung.');
  assert.equal(await page.locator('.kiosk-vote-overview').count(), 0);
  assert.ok(await page.locator('#kiosk-votes .kiosk-vote-state').evaluate((emptyState) => {
    const emptyBox = emptyState.getBoundingClientRect();
    const contentBox = emptyState.parentElement!.getBoundingClientRect();
    return Math.abs(emptyBox.y + emptyBox.height / 2 - (contentBox.y + contentBox.height / 2)) < 2;
  }));
  await page.setViewportSize({ width: 390, height: 844 });
});
