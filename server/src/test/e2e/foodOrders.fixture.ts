// Browser E2E test, food-orders shard: Essensbestellung (food orders).
// One owner process drives the real built server + real Chromium; the shared
// server session, browser context and page live in ./flowsShared.fixture.
// Sibling tests here intentionally share that state and run in order.

import assert from 'node:assert/strict';
import {
  flowTest,
  registerFlowFixture,
  BASE_URL,
  page,
  alice,
  waitForTextDecoration,
  assertMarkerStaysPut,
  setDateTimeField,
  switchIdentityAndOpenFoodOrders,
} from './flowsShared.fixture';

registerFlowFixture('food-orders');

flowTest('Essensbestellung: direkte Zahlung pro Personenblock und Lebenszyklus', async () => {
  await page.click('#nav-food-orders');
  await page.waitForSelector('#order-new-btn');
  await page.click('#order-new-btn');
  await page.getByLabel('Speisekarte (optional)', { exact: true }).waitFor();
  await page.fill('#order-title', "Pizza bei Luigi's");
  await setDateTimeField('order-sendat', '2026-12-24T20:00');
  await page.fill('#order-notes', 'Mindestbestellwert 15€, bar zahlen');
  await page.fill('#order-link', 'https://luigis-pizza.example/karte');
  await page.fill('#order-paypal', 'https://paypal.me/luigi');
  await page.fill('#order-tip', '10');
  await page.click('#order-form button[type="submit"]');
  await page.waitForSelector('text=Pizza bei Luigi');
  await page.waitForSelector('text=24.12. 20:00 Uhr');
  await page.waitForSelector('text=Mindestbestellwert 15€, bar zahlen');
  await page.waitForSelector('a[href="https://luigis-pizza.example/karte"]');
  assert.equal(await page.locator('a[href="https://paypal.me/luigi"] .ui-icon').count(), 1);
  await page.getByRole('button', { name: 'Bestellübersicht', exact: true }).waitFor();

  await page.click('[data-edit-details]');
  await page.getByLabel('Speisekarte', { exact: true }).waitFor();
  await setDateTimeField('sendat-input', '2026-12-24T21:30');
  await page.fill('#notes-input', 'Doch Kartenzahlung möglich');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('text=24.12. 21:30 Uhr');
  await page.waitForSelector('text=Doch Kartenzahlung möglich');

  assert.equal(await page.locator('[data-item-quantity]').inputValue(), '');
  assert.equal(await page.locator('[data-item-quantity]').getAttribute('placeholder'), 'Anzahl');
  assert.equal(await page.locator('.food-order-quantity-field > span').count(), 0);
  assert.equal(await page.locator('[data-item-quantity]').evaluate((input) => getComputedStyle(input).textAlign), 'left');
  await page.fill('[data-item-desc]', 'Margherita groß');
  await page.fill('[data-item-quantity]', '2');
  await page.fill('[data-item-price]', '9,50');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Margherita');
  await page.waitForSelector('.food-order-item-amount:has-text("20,90 €")');
  await page.waitForSelector('.food-order-item-amount:has-text("2 × 9,50 €")');
  await page.waitForSelector('.food-order-item-amount:has-text("inkl. 10% Trinkgeld")');
  await page.waitForSelector('.food-order-group-tip:has-text("inkl. 10 % Trinkgeld")');
  await page.waitForSelector('.food-order-total:has-text("Gesamtsumme inkl. 10% Trinkgeld")');
  await page.waitForSelector('.food-order-overview:has-text("2 Positionen von 1 Person")');
  await page.waitForSelector('.food-order-overview:has-text("0 von 1 bezahlt")');
  await page.waitForSelector('.food-order-overview:has-text("Gesamt 20,90")');
  await page.waitForSelector('.food-order-overview:has-text("offen 20,90")');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { copiedFoodTotal?: string }).copiedFoodTotal = value; } },
    });
  });
  const marghieRow = page.locator('.food-order-item', { hasText: 'Margherita' }).first();
  const rowOrder = await marghieRow.evaluate((row) =>
    Array.from(row.children).map((child) => {
      if (child.matches('.food-order-item-description')) return 'description';
      if (child.matches('.food-order-item-amount')) return 'amount';
      if (child.matches('.food-order-item-action-cluster')) return 'cluster';
      return 'other';
    })
  );
  assert.deepEqual(rowOrder, ['description', 'amount', 'cluster', 'other']);
  assert.equal(await marghieRow.locator('[data-toggle-group-paid], [data-group-pay]').count(), 0);
  await marghieRow.locator('[data-copy-food-total]').click();
  assert.equal(await page.evaluate(() => (window as Window & { copiedFoodTotal?: string }).copiedFoodTotal), '20,90 €');

  const group = page.locator('.food-order-group', { hasText: alice.name });
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="false"]:has-text("Bezahlt?")');
  assert.equal(await group.locator('.food-order-paid-marker').getAttribute('aria-pressed'), 'false');
  const openMarkerGeometry = await group.locator('.food-order-paid-marker').evaluate((marker) => {
    const rect = marker.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
  assert.equal(await group.locator('.food-order-group-amount').innerText(), '20,90 €');
  assert.equal(await group.locator('[data-group-pay]').count(), 1);
  assert.equal(await page.locator('.food-order-item [data-group-pay]').count(), 0);
  const groupActionOrder = await group.locator('.food-order-group-actions').evaluate((actions) =>
    Array.from(actions.children).map((child) => {
      if (child.matches('[data-copy-food-total]')) return 'copy';
      if (child.matches('[data-group-pay]')) return 'paypal';
      if (child.matches('[data-toggle-group-paid]')) return 'paid';
      if (child.matches('[data-remove-group]')) return 'remove';
      return 'spacer';
    })
  );
  assert.deepEqual(groupActionOrder, ['copy', 'paypal', 'paid', 'remove']);

  await page.evaluate(() => {
    const original = window.open;
    (window as unknown as { __restoreWindowOpen: () => void }).__restoreWindowOpen = () => { window.open = original; };
    window.open = ((_url?: string, _target?: string, features?: string) => {
      if (features && features.includes('noopener')) return null;
      const fake = {
        opener: window,
        closed: false,
        _location: '',
        get location() { return this._location; },
        set location(value: string) { this._location = value; },
        close() { this.closed = true; },
      };
      (window as unknown as { __lastPopup: typeof fake }).__lastPopup = fake;
      return fake as unknown as Window;
    }) as typeof window.open;
  });
  const lastPopup = () =>
    page.evaluate(() => {
      const popup = (window as unknown as { __lastPopup?: { location: string; closed: boolean } }).__lastPopup;
      return popup ? { location: popup.location, closed: popup.closed } : null;
    });

  await group.locator('[data-group-pay]').click();
  await page.waitForFunction(() => (window as unknown as { __lastPopup?: { location: string } }).__lastPopup?.location);
  assert.deepEqual(await lastPopup(), { location: 'https://paypal.me/luigi/20.90EUR', closed: false });
  assert.equal(await page.evaluate(() => (window as unknown as { __lastPopup?: { opener: unknown } }).__lastPopup?.opener), null);
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  assert.match(await page.locator('.modal-body p').first().innerText(), /20,90 € für .* an PayPal übergeben \(paypal\.me\)\./);
  await page.waitForSelector('.food-order-confirm-list li:has-text("2 × Margherita groß")');
  assert.equal(await page.locator('[data-confirm-copy]').count(), 2);
  assert.equal(
    await page.locator('[data-confirm-copy-kind="paypal"]').getAttribute('data-confirm-copy'),
    'https://paypal.me/luigi',
  );
  await page.locator('[data-confirm-copy-kind="paypal"]').click();
  assert.equal(await page.evaluate(() => (window as Window & { copiedFoodTotal?: string }).copiedFoodTotal), 'https://paypal.me/luigi');
  await page.locator('[data-confirm-copy-kind="total"]').click();
  assert.equal(await page.evaluate(() => (window as Window & { copiedFoodTotal?: string }).copiedFoodTotal), '20,90 €');
  assert.equal(await page.locator('.modal h2:has-text("Bezahlt?")').count(), 1);
  await page.click('[data-confirm-cancel]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  assert.equal(await group.locator('.food-order-paid-marker').getAttribute('aria-pressed'), 'false');

  await group.locator('[data-group-pay]').click();
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  await page.click('[data-confirm-ok]');
  await page.waitForSelector('text=1 Position als bezahlt markiert.');
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")');
  const paidMarkerGeometry = await group.locator('.food-order-paid-marker').evaluate((marker) => {
    const rect = marker.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
  assertMarkerStaysPut(paidMarkerGeometry, openMarkerGeometry, 'marking the group paid');
  await waitForTextDecoration(group.locator('.food-order-group-amount'), 'line-through');
  await waitForTextDecoration(marghieRow.locator('.food-order-item-description'), 'line-through');
  await waitForTextDecoration(marghieRow.locator('.food-order-item-amount'), 'line-through');
  assert.equal(await marghieRow.locator('[data-remove-item]').isDisabled(), true);
  assert.equal(await marghieRow.locator('[data-copy-food-total]').isDisabled(), false);
  assert.equal(await marghieRow.locator('[data-group-pay]').count(), 0);
  assert.equal(await group.locator('[data-group-pay]').isDisabled(), true);
  assert.equal(await group.locator('[data-remove-group]').isDisabled(), true);
  assert.match((await group.locator('.food-order-paid-marker').getAttribute('title')) ?? '', new RegExp('Bezahlt, bestätigt von ' + alice.name));

  await group.locator('[data-toggle-group-paid]').click();
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="false"]:has-text("Bezahlt?")');
  await waitForTextDecoration(marghieRow.locator('.food-order-item-description'), 'none');

  await page.fill('[data-item-desc]', 'Wasser');
  await page.fill('[data-item-quantity]', '1');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Wasser');
  assert.equal(await group.locator('.food-order-group-meta').innerText(), '3 Positionen · Preis fehlt');
  assert.equal(await group.locator('.food-order-group-amount').innerText(), '20,90 €');
  assert.equal(await group.locator('.food-order-group-copy').getAttribute('data-copy-food-total'), '20,90 €');
  assert.equal(await group.locator('[data-group-pay]').isDisabled(), true);
  await group.locator('[data-remove-group]').click();
  await page.waitForSelector('.modal h2:has-text("Deine 2 Positionen löschen?")');
  assert.equal(await page.locator('.food-order-confirm-list li').count(), 2);
  assert.equal(await page.locator('.modal-body').getByText('Lässt sich nicht rückgängig machen.').count(), 1);
  await page.click('[data-confirm-cancel]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  const wasserRow = page.locator('.food-order-item', { hasText: 'Wasser' });
  await wasserRow.locator('[data-remove-item]').click();
  await page.waitForSelector('[data-confirm]');
  assert.equal(await page.locator('.modal h2').innerText(), '1 × Wasser löschen?');
  await page.click('[data-cancel]');
  await wasserRow.waitFor();
  await wasserRow.locator('[data-remove-item]').click();
  await page.click('[data-confirm]');
  await page.waitForSelector('.food-order-item:has-text("Wasser")', { state: 'detached' });

  // A previously paid group becomes payable again when a new priced position
  // is added. The full group sum is shown and the already-paid item remains
  // visible in the handoff. Only the newly added unpaid item is marked after
  // confirmation.
  await group.locator('[data-group-pay]').click();
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  await page.click('[data-confirm-ok]');
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")');
  await page.fill('[data-item-desc]', 'Nachtrag nach Bestätigung');
  await page.fill('[data-item-quantity]', '1');
  await page.fill('[data-item-price]', '4,00');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Nachtrag nach Bestätigung');
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="false"]:has-text("Bezahlt?")');
  assert.equal(await group.locator('.food-order-group-amount').innerText(), '25,30 €');
  const changedTotalMarkerGeometry = await group.locator('.food-order-paid-marker').evaluate((marker) => {
    const rect = marker.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
  assertMarkerStaysPut(changedTotalMarkerGeometry, openMarkerGeometry, 'adding a position to a paid group');
  assert.equal(await group.locator('[data-group-pay]').isDisabled(), false);
  await group.locator('[data-group-pay]').click();
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  assert.match(await page.locator('.modal-body p').first().innerText(), /25,30 € für/);
  assert.equal(await page.locator('.food-order-confirm-list li').count(), 2);
  await page.waitForSelector('.food-order-confirm-list li:has-text("2 × Margherita groß")');
  await page.waitForSelector('.food-order-confirm-list li:has-text("Nachtrag nach Bestätigung")');
  await page.click('[data-confirm-cancel]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  await group.locator('[data-group-pay]').click();
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  await page.click('[data-confirm-ok]');
  await page.waitForSelector('text=1 Position als bezahlt markiert.');
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")');

  await page.keyboard.press('Control+K');
  await page.fill('#global-search-input', 'Margherita groß');
  await page.waitForSelector('.global-search-result:has-text("Pizza bei Luigi")');
  await page.click('.global-search-result:has-text("Pizza bei Luigi")');
  await page.waitForSelector('[data-order-card].search-target-highlight');

  // Keep the realtime follow-up GET pending while the close response is
  // applied. The lifecycle change must render from that response directly:
  // no one-line loading frame, no scroll reset, and the moved order remains
  // visible in the automatically opened history.
  let releaseCloseRefresh!: () => void;
  let closeRefreshSeen!: () => void;
  let closeRefreshFinished!: () => void;
  const closeRefreshRelease = new Promise<void>((resolve) => { releaseCloseRefresh = resolve; });
  const closeRefreshStarted = new Promise<void>((resolve) => { closeRefreshSeen = resolve; });
  const closeRefreshDone = new Promise<void>((resolve) => { closeRefreshFinished = resolve; });
  let closeRefreshBlocked = false;
  const closeRefreshRoute = async (route: import('playwright').Route) => {
    if (route.request().method() === 'GET' && !closeRefreshBlocked) {
      closeRefreshBlocked = true;
      closeRefreshSeen();
      await closeRefreshRelease;
      const response = await route.fetch();
      await route.fulfill({ response });
      closeRefreshFinished();
      return;
    }
    await route.continue();
  };
  await page.route('**/api/food-orders', closeRefreshRoute);
  const foodScroller = page.locator('#view-container');
  const scrollTopBeforeClose = await foodScroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  assert.ok(scrollTopBeforeClose > 0);
  try {
    await page.click('[data-close-order]');
    await page.click('[data-confirm]');
    await closeRefreshStarted;
    await page.waitForSelector('[data-food-history][open] .badge-paused:has-text("Abgeschickt")');
    assert.equal(await page.getByText('Lädt…', { exact: true }).count(), 0);
    assert.equal(await page.locator('[data-closed-order]', { hasText: 'Pizza bei Luigi' }).isVisible(), true);
    assert.ok(await foodScroller.evaluate((element) => element.scrollTop > 0));
  } finally {
    releaseCloseRefresh();
    if (closeRefreshBlocked) await closeRefreshDone;
    await page.unroute('**/api/food-orders', closeRefreshRoute);
  }
  await page.click('[data-reopen-order]');
  await page.waitForSelector('.badge-playing >> text=Offen');
  await page.fill('[data-item-desc]', 'Vergessene Cola');
  await page.fill('[data-item-quantity]', '1');
  await page.fill('[data-item-price]', '2,50');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Vergessene Cola');
  await page.click('[data-close-order]');
  await page.click('[data-confirm]');
  await page.waitForSelector('.badge-paused >> text=Abgeschickt');
  await page.click('[data-finalize-order]');
  await page.click('[data-confirm]');
  await page.waitForSelector('.badge-offline >> text=Geschlossen');
  const closedOrder = page.locator('[data-closed-order]', { hasText: 'Pizza bei Luigi' });
  assert.equal(await closedOrder.locator('[data-reopen-order]').count(), 1);
  assert.equal(await closedOrder.locator('[data-edit-details]').count(), 0);
  assert.equal(await closedOrder.locator('[data-toggle-group-paid]').first().isDisabled(), true);
  assert.equal(await closedOrder.locator('[data-group-pay]').first().isDisabled(), true);

  // Finalizing is reversible one lock step at a time: reopening a finalized
  // order drops it back to "Abgeschickt", unlocking payment marking and
  // metadata edits again while items stay frozen.
  await closedOrder.locator('[data-reopen-order]').click();
  await page.waitForSelector('.badge-paused >> text=Abgeschickt');
  assert.equal(await closedOrder.locator('[data-edit-details]').count(), 1);
  assert.equal(await closedOrder.locator('[data-toggle-group-paid]').first().isDisabled(), false);

  await page.evaluate(() => (window as unknown as { __restoreWindowOpen: () => void }).__restoreWindowOpen());
});

flowTest('Essensbestellung: orderer groups collapse/expand and pay as a group', async () => {
  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');
  await page.click('#order-new-btn');
  await page.fill('#order-title', 'Gruppen-Test-Bestellung');
  await page.click('#order-form button[type="submit"]');
  await page.waitForSelector('text=Gruppen-Test-Bestellung');
  const groupOrderCard = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' });

  await groupOrderCard.locator('[data-item-desc]').fill('Alice-Snack');
  await groupOrderCard.locator('[data-item-quantity]').fill('1');
  await groupOrderCard.locator('[data-item-price]').fill('3,00');
  await groupOrderCard.locator('[data-add-item-form] button[type="submit"]').click();
  await page.waitForSelector('text=Alice-Snack');
  assert.equal(await groupOrderCard.locator('.food-order-group-toggle').count(), 0);
  assert.equal(await groupOrderCard.locator('[data-toggle-all-groups]').count(), 0);
  assert.equal(await groupOrderCard.locator('.food-order-card-header-toggle').count(), 0);

  await switchIdentityAndOpenFoodOrders('E2E Bob');
  const bobFormCard = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' });
  await bobFormCard.locator('[data-item-desc]').fill('Bob Erster Snack');
  await bobFormCard.locator('[data-item-quantity]').fill('1');
  await bobFormCard.locator('[data-item-price]').fill('1,00');
  await bobFormCard.locator('[data-add-item-form] button[type="submit"]').click();
  await page.waitForSelector('text=Bob Erster Snack');

  const orderCard = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' });
  const bobGroup = orderCard.locator('.food-order-group', { hasText: 'E2E Bob' });
  const aliceGroup = orderCard.locator('.food-order-group', { hasText: 'E2E Alice Pro' });
  await bobGroup.locator('.food-order-group-toggle').waitFor();
  assert.equal(await bobGroup.locator('.food-order-group-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await aliceGroup.locator('.food-order-group-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await aliceGroup.locator('.food-order-group-items').isHidden(), true);
  assert.match(await bobGroup.locator('.food-order-group-toggle').innerText(), /E2E Bob \(du\)/);
  assert.equal(await bobGroup.locator('.food-order-group-toggle[aria-expanded="true"] .food-order-group-meta').textContent(), '1 Position');
  assert.equal(await bobGroup.locator('.food-order-group-amount').innerText(), '1,00 €');
  assert.equal(await bobGroup.locator('.food-order-item-copy').getAttribute('title'), 'Betrag dieser Position kopieren');

  await orderCard.locator('[data-toggle-all-groups]').click();
  await aliceGroup.locator('.food-order-group-toggle[aria-expanded="true"]').waitFor();
  assert.equal(await orderCard.locator('[data-toggle-all-groups]').innerText(), 'Alle einklappen');
  await orderCard.locator('[data-toggle-all-groups]').click();
  assert.equal(await aliceGroup.locator('.food-order-group-toggle').getAttribute('aria-expanded'), 'false');

  assert.equal(await bobGroup.locator('.food-order-group-toggle').getAttribute('aria-expanded'), 'false');
  await bobFormCard.locator('[data-item-desc]').fill('Bob Zweiter Snack');
  await bobFormCard.locator('[data-item-quantity]').fill('1');
  await bobFormCard.locator('[data-item-price]').fill('1,50');
  await bobFormCard.locator('[data-add-item-form] button[type="submit"]').click();
  await page.waitForSelector('text=Bob Zweiter Snack');
  assert.equal(await bobGroup.locator('.food-order-group-toggle').getAttribute('aria-expanded'), 'true');

  assert.equal(await bobGroup.locator('[data-group-pay]').count(), 0);

  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');
  const detailsCard = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' });
  await detailsCard.locator('[data-edit-details]').click();
  await page.fill('#paypal-input', 'https://paypal.me/luigi');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('[data-group-pay]');

  const bobGroupAfterLink = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' }).locator('.food-order-group', { hasText: 'E2E Bob' });
  const bobMarker = bobGroupAfterLink.locator('[data-toggle-group-paid]');
  await bobMarker.click();
  await bobGroupAfterLink.locator('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")').waitFor();
  assert.equal(await bobGroupAfterLink.locator('[data-group-pay]').isDisabled(), true);
  assert.equal(await bobGroupAfterLink.locator('[data-toggle-group-paid]').getAttribute('aria-pressed'), 'true');
  assert.equal(await bobGroupAfterLink.locator('.food-order-item .food-order-paid-marker').count(), 0);
  assert.equal(await bobGroupAfterLink.locator('[data-remove-group]').count(), 0);

  // The compact payment marker plus three action slots must remain inside the
  // header at the narrowest supported phone width instead of being clipped.
  await page.setViewportSize({ width: 320, height: 720 });
  const narrowGroupLayout = await bobGroupAfterLink.locator('.food-order-group-header').evaluate((header) => {
    const box = header.getBoundingClientRect();
    const marker = header.querySelector('.food-order-paid-marker');
    const controls = Array.from(header.querySelectorAll('.food-order-paid-marker, .food-order-group-amount, .food-order-group-actions button'));
    return {
      markerWidth: marker?.getBoundingClientRect().width ?? 0,
      markerHeight: marker?.getBoundingClientRect().height ?? 0,
      controlBounds: controls.map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          name: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? control.tagName,
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      }),
      headerBounds: { left: box.left, right: box.right },
      controlsVisible: controls.every((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width > 0 && rect.left >= box.left - 1 && rect.right <= box.right + 1;
      }),
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  assert.ok(narrowGroupLayout.markerWidth <= 100);
  assert.ok(narrowGroupLayout.markerHeight >= 32);
  assert.equal(narrowGroupLayout.controlsVisible, true, JSON.stringify(narrowGroupLayout));
  assert.equal(narrowGroupLayout.pageFits, true);
  await page.setViewportSize({ width: 390, height: 844 });

  // Bob can undo the paid marker directly; reopening the group is an explicit
  // toggle and does not require a second confirmation dialog.
  await switchIdentityAndOpenFoodOrders('E2E Bob');
  const bobPaidGroup = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' }).locator('.food-order-group', { hasText: 'E2E Bob' });
  await bobPaidGroup.locator('[data-toggle-group-paid]').click();
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="false"]:has-text("Bezahlt?")');
});

flowTest('Essensbestellung: PayPal-Handoff verwirft veraltete Daten und bleibt synchron', async () => {
  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');

  type FoodScenario = { id: string; itemIds: string[]; title: string };
  type ScenarioItem = { description: string; priceCents?: number };

  const createScenario = async (title: string, items: ScenarioItem[], paypalLink = 'https://paypal.me/fresh-test', tipPercent?: number): Promise<FoodScenario> => {
    const orderResponse = await page.request.post(`${BASE_URL}/api/food-orders`, {
      data: { playerId: alice.id, title, paypalLink, ...(tipPercent === undefined ? {} : { tipPercent }) },
    });
    assert.equal(orderResponse.status(), 201, await orderResponse.text());
    const order = await orderResponse.json() as { id: string };
    let itemIds: string[] = [];
    for (const item of items) {
      const itemResponse = await page.request.post(`${BASE_URL}/api/food-orders/${order.id}/items`, {
        data: {
          playerId: alice.id,
          description: item.description,
          quantity: 1,
          ...(item.priceCents === undefined ? {} : { priceCents: item.priceCents }),
        },
      });
      assert.equal(itemResponse.status(), 201, await itemResponse.text());
      const serialized = await itemResponse.json() as { items: Array<{ id: string }> };
      itemIds = serialized.items.map((entry) => entry.id);
    }
    return { id: order.id, itemIds, title };
  };

  const openScenario = async (scenario: FoodScenario) => {
    await page.reload();
    await page.waitForSelector('#app:not([hidden])');
    await page.click('#nav-food-orders');
    // Use the generated id instead of the title: a failed/retried scenario
    // can leave an older card with the same title in the shared test event.
    // Matching that card makes the following group wait hang even though the
    // newly created scenario has already rendered correctly.
    const card = page.locator(`[data-order-card="${scenario.id}"]`);
    await card.waitFor();
    if (await card.locator('.food-order-card-body').getAttribute('hidden') !== null) {
      await card.locator('.food-order-card-header-toggle').click();
    }
    await card.locator('.food-order-card-body').waitFor({ state: 'visible' });
    const group = card.locator('.food-order-group', { hasText: 'E2E Alice Pro' });
    await group.locator('.food-order-group-header').waitFor();
    return { card, group };
  };

  const cleanupScenario = async (scenario: FoodScenario) => {
    const response = await page.request.delete(`${BASE_URL}/api/food-orders/${scenario.id}`);
    assert.ok([204, 404].includes(response.status()), await response.text());
  };

  // Keep the popup synchronous with the click while making its opener
  // harmless, exactly like the production handoff hardening requires.
  await page.evaluate(() => {
    const original = window.open;
    (window as unknown as { __restoreFreshPopup?: () => void }).__restoreFreshPopup = () => { window.open = original; };
    window.open = ((_url?: string, _target?: string, _features?: string) => {
      const popup = {
        opener: window as unknown as Window,
        closed: false,
        _location: '',
        get location() { return this._location; },
        set location(value: string) { this._location = value; },
        close() { this.closed = true; },
      };
      (window as unknown as { __freshPopup?: typeof popup }).__freshPopup = popup;
      return popup as unknown as Window;
    }) as typeof window.open;
  });

  const runStalePayCase = async (
    title: string,
    mutate: (scenario: FoodScenario) => Promise<void>,
    expectedMessage: string,
  ) => {
    const scenario = await createScenario(title, [{ description: `${title} Position`, priceCents: 5_00 }]);
    const { group } = await openScenario(scenario);
    let intercepted = false;
    const routeHandler = async (route: import('playwright').Route) => {
      if (!intercepted && route.request().method() === 'GET') {
        intercepted = true;
        await mutate(scenario);
      }
      await route.continue();
    };
    await page.route('**/api/food-orders', routeHandler);
    try {
      await group.locator('[data-group-pay]').click();
      await page.waitForSelector(`.toast-error:has-text("${expectedMessage}")`);
      assert.equal(intercepted, true);
    } finally {
      await page.unroute('**/api/food-orders', routeHandler);
    }
    await cleanupScenario(scenario);
  };

  await runStalePayCase(
    'Freshness gelöschte Position',
    async (scenario) => {
      const response = await page.request.delete(`${BASE_URL}/api/food-orders/${scenario.id}/items/${scenario.itemIds[0]}`, { data: { playerId: alice.id } });
      assert.equal(response.status(), 200, await response.text());
    },
    'Eine Position existiert nicht mehr. Bitte Betrag prüfen.',
  );
  await runStalePayCase(
    'Freshness bezahlte Position',
    async (scenario) => {
      const response = await page.request.patch(`${BASE_URL}/api/food-orders/${scenario.id}/items/${scenario.itemIds[0]}`, { data: { paid: true } });
      assert.equal(response.status(), 200, await response.text());
    },
    'Diese Person wurde inzwischen bereits als bezahlt markiert.',
  );
  await runStalePayCase(
    'Freshness entfernter PayPal-Link',
    async (scenario) => {
      const response = await page.request.patch(`${BASE_URL}/api/food-orders/${scenario.id}`, { data: { paypalLink: null } });
      assert.equal(response.status(), 200, await response.text());
    },
    'Für diese Bestellung ist kein PayPal-Link mehr hinterlegt.',
  );
  await runStalePayCase(
    'Freshness gelöschte Bestellung',
    async (scenario) => {
      const response = await page.request.delete(`${BASE_URL}/api/food-orders/${scenario.id}`);
      assert.equal(response.status(), 204, await response.text());
    },
    'Diese Bestellung existiert nicht mehr.',
  );
  await runStalePayCase(
    'Freshness abgeschlossene Bestellung',
    async (scenario) => {
      const closeResponse = await page.request.post(`${BASE_URL}/api/food-orders/${scenario.id}/close`);
      assert.equal(closeResponse.status(), 200, await closeResponse.text());
      const finalizeResponse = await page.request.post(`${BASE_URL}/api/food-orders/${scenario.id}/finalize`);
      assert.equal(finalizeResponse.status(), 200, await finalizeResponse.text());
    },
    'Bestellung geschlossen – keine Änderungen mehr möglich',
  );

  const genericPaypalLink = 'https://www.paypal.com/myaccount/transfer/homepage/pay?recipient=luigi%40example.com';
  const genericPaypalScenario = await createScenario(
    'Freshness allgemeiner PayPal-Link',
    [{ description: 'Allgemeiner PayPal-Link Position', priceCents: 5_00 }],
    genericPaypalLink,
  );
  const { group: genericPaypalGroup } = await openScenario(genericPaypalScenario);
  await page.evaluate(() => {
    window.open = ((_url?: string, _target?: string, _features?: string) => {
      const popup = {
        opener: window as unknown as Window,
        closed: false,
        _location: '',
        get location() { return this._location; },
        set location(value: string) { this._location = value; },
        close() { this.closed = true; },
      };
      (window as unknown as { __freshPopup?: typeof popup }).__freshPopup = popup;
      return popup as unknown as Window;
    }) as typeof window.open;
  });
  await genericPaypalGroup.locator('[data-group-pay]').click();
  await page.waitForFunction(() => (window as unknown as { __freshPopup?: { location: string } }).__freshPopup?.location);
  assert.deepEqual(
    await page.evaluate(() => {
      const popup = (window as unknown as { __freshPopup?: { location: string; closed: boolean } }).__freshPopup;
      return popup ? { location: popup.location, closed: popup.closed } : null;
    }),
    { location: genericPaypalLink, closed: false },
  );
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  assert.match(
    await page.locator('.modal-body p').first().innerText(),
    /PayPal geöffnet\. Die Summe 5,00 € für .* wird dort nicht vorausgefüllt\./,
  );
  await page.click('[data-confirm-cancel]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  await cleanupScenario(genericPaypalScenario);

  // In a mixed group, a paid legacy position may be present after a new item
  // was added. It is still part of the initial group and its disappearance
  // must abort the handoff, while the paid-state race only covers open items.
  const mixedDeleteScenario = await createScenario('Freshness gelöschte Altposition', [
    { description: 'Bereits bezahlte Altposition', priceCents: 5_00 },
    { description: 'Offener Nachtrag', priceCents: 4_00 },
  ]);
  const paidResponse = await page.request.patch(`${BASE_URL}/api/food-orders/${mixedDeleteScenario.id}/items/${mixedDeleteScenario.itemIds[0]}`, { data: { paid: true } });
  assert.equal(paidResponse.status(), 200, await paidResponse.text());
  const { group: mixedDeleteGroup } = await openScenario(mixedDeleteScenario);
  let mixedDeleteIntercepted = false;
  const mixedDeleteRoute = async (route: import('playwright').Route) => {
    if (!mixedDeleteIntercepted && route.request().method() === 'GET') {
      mixedDeleteIntercepted = true;
      // The real DELETE route correctly refuses paid positions. Simulate a
      // stale server response instead, so this test still covers a previously
      // paid legacy position disappearing from the complete initial group.
      const response = await route.fetch();
      const payload = await response.json() as { orders: Array<{ id: string; items: Array<{ id: string }> }> };
      const targetOrder = payload.orders.find((order) => order.id === mixedDeleteScenario.id);
      assert.ok(targetOrder);
      targetOrder.items = targetOrder.items.filter((item) => item.id !== mixedDeleteScenario.itemIds[0]);
      await route.fulfill({ response, json: payload });
      return;
    }
    await route.continue();
  };
  await page.route('**/api/food-orders', mixedDeleteRoute);
  try {
    await mixedDeleteGroup.locator('[data-group-pay]').click();
    await page.waitForSelector('.toast-error:has-text("Eine Position existiert nicht mehr. Bitte Betrag prüfen.")');
    assert.equal(mixedDeleteIntercepted, true);
  } finally {
    await page.unroute('**/api/food-orders', mixedDeleteRoute);
  }
  await cleanupScenario(mixedDeleteScenario);

  // A zero-priced position is still a valid priced position. Together with a
  // missing price it must expose the 0,00 € subtotal and keep its copy action.
  const zeroScenario = await createScenario('Freshness Nullbetrag plus offen', [
    { description: 'Nullbetrag', priceCents: 0 },
    { description: 'Preis noch offen' },
  ]);
  const { card: zeroCard, group: zeroGroup } = await openScenario(zeroScenario);
  assert.match(await zeroCard.locator('.food-order-total').innerText(), /Gesamtsumme.*unvollständig[\s\S]*0,00/);
  assert.equal(await zeroGroup.locator('.food-order-group-meta').innerText(), '2 Positionen · Preis fehlt');
  assert.equal(await zeroGroup.locator('.food-order-group-amount').innerText(), '0,00 €');
  assert.equal(await zeroGroup.locator('.food-order-group-copy').getAttribute('data-copy-food-total'), '0,00 €');
  assert.equal(await zeroGroup.locator('[data-group-pay]').isDisabled(), true);
  await zeroGroup.locator('[data-toggle-group-paid]').click();
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")');
  await waitForTextDecoration(zeroGroup.locator('.food-order-group-amount'), 'line-through');
  await cleanupScenario(zeroScenario);

  // Tip rounding is defined per payable line, so the group sum, order
  // overview, total row and PayPal handoff must agree even when aggregation
  // would round differently (two 1-cent lines at 50% tip are 0,04 €).
  const roundingScenario = await createScenario('Trinkgeld-Rundung', [
    { description: 'Ein-Cent-Position A', priceCents: 1 },
    { description: 'Ein-Cent-Position B', priceCents: 1 },
  ], 'https://paypal.me/rounding-test', 50);
  const { card: roundingCard, group: roundingGroup } = await openScenario(roundingScenario);
  assert.equal(await roundingGroup.locator('.food-order-group-amount').innerText(), '0,04 €');
  assert.match(await roundingCard.locator('.food-order-overview').innerText(), /Gesamt 0,04 €/);
  assert.match(await roundingCard.locator('.food-order-total').innerText(), /0,04 €/);
  await cleanupScenario(roundingScenario);

  // While the first fresh GET is paused, an item add triggers the realtime
  // refresh path. The shared single-flight coordinator must settle on the
  // current group snapshot: the new item belongs in the complete handoff
  // amount and list, but remains open until the confirmation is accepted.
  const concurrencyScenario = await createScenario('Freshness parallele Aktualisierung', [{ description: 'Erster Betrag', priceCents: 2_50 }]);
  const { group: concurrencyGroup } = await openScenario(concurrencyScenario);
  let firstRequestSeen!: () => void;
  let releaseFirstRequest!: () => void;
  let followUpGetSeen!: () => void;
  const firstSeen = new Promise<void>((resolve) => { firstRequestSeen = resolve; });
  const release = new Promise<void>((resolve) => { releaseFirstRequest = resolve; });
  const followUpGet = new Promise<void>((resolve) => { followUpGetSeen = resolve; });
  let orderListGetCount = 0;
  const concurrencyRoute = async (route: import('playwright').Route) => {
    if (route.request().method() === 'GET') {
      orderListGetCount += 1;
      if (orderListGetCount === 2) followUpGetSeen();
      if (orderListGetCount === 1) {
        firstRequestSeen();
        await release;
      }
    }
    await route.continue();
  };
  await page.route('**/api/food-orders', concurrencyRoute);
  try {
    await concurrencyGroup.locator('[data-group-pay]').click();
    await firstSeen;
    const addResponse = await page.request.post(`${BASE_URL}/api/food-orders/${concurrencyScenario.id}/items`, {
      data: { playerId: alice.id, description: 'Nachtrag während Refresh', quantity: 1, priceCents: 1_00 },
    });
    assert.equal(addResponse.status(), 201, await addResponse.text());
    assert.ok(orderListGetCount >= 1);
    releaseFirstRequest();
    await followUpGet;
    await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
    assert.match(await page.locator('.modal-body p').first().innerText(), /3,50 € für/);
    assert.equal(await page.locator('.food-order-confirm-list li').count(), 2);
    assert.equal(await page.locator('.food-order-confirm-list li:has-text("Nachtrag während Refresh")').count(), 1);
    await page.click('[data-confirm-cancel]');
    await page.waitForSelector('.modal-backdrop', { state: 'detached' });
    await concurrencyGroup.locator('.food-order-item', { hasText: 'Nachtrag während Refresh' }).waitFor();
  } finally {
    await page.unroute('**/api/food-orders', concurrencyRoute);
  }
  await cleanupScenario(concurrencyScenario);

  // Group deletion is confirmed against a visible snapshot. A position added
  // while that dialog is open is outside the confirmed list and must survive.
  const deleteSnapshotScenario = await createScenario('Freshness Löschen-Snapshot', [{ description: 'Vorhandene Position', priceCents: 1_00 }]);
  const { card: deleteSnapshotCard, group: deleteSnapshotGroup } = await openScenario(deleteSnapshotScenario);
  let deleteSnapshotIntercepted = false;
  const deleteSnapshotRoute = async (route: import('playwright').Route) => {
    if (!deleteSnapshotIntercepted && route.request().method() === 'GET') {
      deleteSnapshotIntercepted = true;
      const response = await page.request.post(`${BASE_URL}/api/food-orders/${deleteSnapshotScenario.id}/items`, {
        data: { playerId: alice.id, description: 'Während Bestätigung ergänzt', quantity: 1, priceCents: 2_00 },
      });
      assert.equal(response.status(), 201, await response.text());
    }
    await route.continue();
  };
  await page.route('**/api/food-orders', deleteSnapshotRoute);
  try {
    await deleteSnapshotGroup.locator('[data-remove-group]').click();
    await page.waitForSelector('.modal h2:has-text("Deine 1 Position löschen?")');
    await page.click('[data-confirm-ok]');
    await page.waitForSelector('text=Während Bestätigung ergänzt');
    await deleteSnapshotCard.locator('.food-order-item', { hasText: 'Vorhandene Position' }).waitFor({ state: 'detached' });
    assert.equal(await deleteSnapshotCard.locator('.food-order-item', { hasText: 'Während Bestätigung ergänzt' }).count(), 1);
    assert.equal(deleteSnapshotIntercepted, true);
  } finally {
    await page.unroute('**/api/food-orders', deleteSnapshotRoute);
  }
  await cleanupScenario(deleteSnapshotScenario);

  // Promise.all deletion is deliberately partial-safe: if one DELETE fails,
  // the successful sibling is gone, the failed one remains, and the quiet
  // authoritative refresh reconciles both without a loading frame.
  const partialScenario = await createScenario('Freshness Teil-Löschen', [
    { description: 'Teilweise entfernen', priceCents: 1_00 },
    { description: 'Teilweise behalten', priceCents: 1_50 },
  ]);
  const { card: partialCard, group: partialGroup } = await openScenario(partialScenario);
  const failingItemId = partialScenario.itemIds[1];
  const partialRoute = async (route: import('playwright').Route) => {
    if (route.request().method() === 'DELETE' && route.request().url().endsWith(`/items/${failingItemId}`)) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Simulierter Teilfehler' }) });
      return;
    }
    await route.continue();
  };
  await page.route(`**/api/food-orders/${partialScenario.id}/items/${failingItemId}`, partialRoute);
  try {
    await partialGroup.locator('[data-remove-group]').click();
    await page.waitForSelector('.modal h2:has-text("Deine 2 Positionen löschen?")');
    await page.click('[data-confirm-ok]');
    await page.waitForSelector('.toast-error');
    await partialCard.locator('.food-order-item', { hasText: 'Teilweise entfernen' }).waitFor({ state: 'detached' });
    await partialCard.locator('.food-order-item', { hasText: 'Teilweise behalten' }).waitFor();
  } finally {
    await page.unroute(`**/api/food-orders/${partialScenario.id}/items/${failingItemId}`, partialRoute);
  }
  await cleanupScenario(partialScenario);
  await page.evaluate(() => (window as unknown as { __restoreFreshPopup?: () => void }).__restoreFreshPopup?.());
});

flowTest('Essensbestellung: Bestellübersicht consolidates positions for the creator/admin and can close the order', async () => {
  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');
  await page.click('#order-new-btn');
  await page.fill('#order-title', 'Bestellübersicht-Test');
  await page.fill('#order-tip', '10');
  const createOrderResponse = page.waitForResponse(
    (response) => response.url() === `${BASE_URL}/api/food-orders` && response.request().method() === 'POST',
  );
  await page.click('#order-form button[type="submit"]');
  const createdOrderResponse = await createOrderResponse;
  assert.equal(createdOrderResponse.status(), 201, await createdOrderResponse.text());
  const createdOrder = await createdOrderResponse.json() as { id: string; open: boolean };
  assert.equal(createdOrder.open, true);
  const listOrderId = createdOrder.id;
  const listOrderCard = page.locator(`[data-order-card="${listOrderId}"]`);
  await listOrderCard.waitFor();

  // "Gruppen-Test-Bestellung" (from the previous test) is still open, so
  // there are now two open orders at once - each card gets its own
  // whole-order collapse toggle, independent of the per-orderer-group one.
  // The just-created order stays open while the older one starts collapsed;
  // that state must survive a live re-render triggered elsewhere (the item
  // adds below).
  const groupOrderCard = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' });
  await page.waitForSelector('.food-order-card-header-toggle');
  assert.equal(await groupOrderCard.locator('.food-order-card-header-toggle').count(), 1);
  assert.equal(await listOrderCard.locator('.food-order-card-header-toggle').count(), 1);
  assert.equal(await groupOrderCard.locator('.food-order-card-header-toggle .food-order-card-title').innerText(), 'Gruppen-Test-Bestellung');
  assert.equal(await groupOrderCard.locator('.food-order-card-body').getAttribute('hidden'), '');
  assert.equal(await groupOrderCard.locator('.food-order-card-body').isVisible(), false);
  assert.equal(await listOrderCard.locator('.food-order-card-body').isVisible(), true);

  const addItem = async (desc: string, quantity: string, price?: string) => {
    await listOrderCard.locator('[data-item-desc]').fill(desc);
    await listOrderCard.locator('[data-item-quantity]').fill(quantity);
    if (price) await listOrderCard.locator('[data-item-price]').fill(price);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url() === `${BASE_URL}/api/food-orders/${listOrderId}/items` &&
        response.request().method() === 'POST',
    );
    await listOrderCard.locator('[data-add-item-form] button[type="submit"]').click();
    const response = await responsePromise;
    assert.equal(response.status(), 201, await response.text());
    // Earlier orders in this shared shard contain the same descriptions.
    // A page-wide or case-insensitive wait can therefore resolve before this
    // exact add and live re-render finish, letting the next add race it.
    await listOrderCard.getByText(`${quantity} × ${desc}`, { exact: true }).waitFor();
  };
  await addItem('Margherita', '1', '8,50');
  await addItem('margherita', '2', '8,50');
  await addItem('Wasser', '1');

  // The three item-add re-renders above must not have silently re-expanded
  // "Gruppen-Test-Bestellung" again - collapse state belongs to the person
  // looking at it, same rule as the orderer-group toggle above.
  assert.equal(await groupOrderCard.locator('.food-order-card-body').isVisible(), false);
  await groupOrderCard.locator('.food-order-card-header-toggle').click();
  await page.waitForSelector('[data-order-card]:has-text("Gruppen-Test-Bestellung") .food-order-card-body:not([hidden])');

  await listOrderCard.locator('[data-open-order-list]').click();
  await page.waitForSelector('.modal h2:has-text("Bestellübersicht – Bestellübersicht-Test")');
  // Same normalized description + same price merges into one consolidated
  // row (AP4.2) — 1 + 2 = 3 × Margherita.
  await page.waitForSelector('.food-order-consolidated-row:has-text("3 × Margherita")');
  await page.waitForSelector('.food-order-consolidated-row:has-text("1 × Wasser")');
  await page.waitForSelector('.food-order-consolidated-row:has-text("kein Preis")');
  await page.waitForSelector('text=Bestellung ist noch offen.');
  // Unpriced Wasser keeps the subtotal flagged as incomplete.
  await page.waitForSelector('.food-order-consolidated-totals:has-text("Zwischensumme (unvollständig)")');
  await page.waitForSelector('.food-order-consolidated-totals:has-text("+ 10% Trinkgeld")');
  await page.waitForSelector('.food-order-consolidated-totals:has-text("Gesamt (unvollständig)")');

  // The clipboard "Liste kopieren" action was removed - the dialog no longer
  // offers it at all.
  assert.equal(await page.locator('[data-copy-consolidated-list]').count(), 0);

  // A direct food-order link expands the target before the first populated
  // render, even though multiple open orders currently exist.
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  await page.goto(`${BASE_URL}/#foodOrders/${listOrderId}`);
  await page.reload();
  const directOrderCard = page.locator('[data-order-card]', { hasText: 'Bestellübersicht-Test' });
  await directOrderCard.waitFor();
  assert.equal(await directOrderCard.locator('.food-order-card-body').isVisible(), true);

  // Home's Aktuell entry carries the same order target as a push/deep link,
  // so tapping it also lands on the expanded card.
  await page.click('.nav-btn[data-view="home"]');
  const currentOrder = page.locator(`[data-current-item="food-order:${listOrderId}"]`);
  await currentOrder.waitFor();
  await currentOrder.locator('.home-current-navigate').click();
  await directOrderCard.waitFor();
  assert.equal(await directOrderCard.locator('.food-order-card-body').isVisible(), true);

  // The dialog can close the still-open order directly (AP4.7).
  await directOrderCard.locator('[data-open-order-list]').click();
  await page.click('[data-close-order-from-list]');
  await page.click('[data-confirm]');
  await page.waitForSelector('text=Bestellung ist noch offen.', { state: 'detached' });
  await page.waitForSelector('[data-close-order-from-list]', { state: 'detached' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });

  // Sent orders live in the collapsed history. A reminder/push-style direct
  // link must open that section so the requested order is immediately visible.
  await page.goto(`${BASE_URL}/#foodOrders/${listOrderId}`);
  await page.reload();
  const directHistory = page.locator('[data-food-history]');
  await directHistory.waitFor();
  assert.equal(await directHistory.getAttribute('open'), '');
  assert.equal(
    await page.locator('[data-closed-order]', { hasText: 'Bestellübersicht-Test' }).isVisible(),
    true,
  );

  // The list is visible to everyone, including a non-creator on a closed order.
  await switchIdentityAndOpenFoodOrders('E2E Bob');
  await page.waitForSelector('text=Bestellübersicht-Test');
  assert.equal(
    await page.locator('[data-closed-order]', { hasText: 'Bestellübersicht-Test' }).locator('[data-open-order-list]').count(),
    1
  );

  // Leave the shared page back on Alice's identity - every later flow in
  // this shard assumes that starting point, same as before these food-order
  // tests started switching identities.
  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');
});

flowTest("Essensbestellung: the description field suggests the order's own existing positions while typing", async (t) => {
  const realtimeProbeOrderIds: string[] = [];
  t.after(async () => {
    for (const probeOrderId of realtimeProbeOrderIds) {
      const response = await page.request.delete(`${BASE_URL}/api/food-orders/${probeOrderId}`);
      assert.ok([204, 404].includes(response.status()), await response.text());
    }
  });

  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');
  await page.click('#order-new-btn');
  await page.fill('#order-title', 'Vorschlags-Test');
  await page.click('#order-form button[type="submit"]');
  await page.waitForSelector('text=Vorschlags-Test');
  const suggestOrderCard = page.locator('[data-order-card]', { hasText: 'Vorschlags-Test' });
  if (await suggestOrderCard.locator('.food-order-card-body').getAttribute('hidden') !== null) {
    await suggestOrderCard.locator('.food-order-card-header-toggle').click();
  }

  // A brand-new order's first position has nothing to suggest yet - the
  // description field stays a plain text input without the search-select
  // chrome.
  assert.equal(await suggestOrderCard.locator('[data-desc-suggest]').count(), 0);

  // Instrument document.addEventListener/removeEventListener before any
  // dropdown-bearing render happens, so the counter below reflects the true
  // number of 'pointerdown' listeners wireDescSuggest() has registered - not
  // just a delta from some later point.
  await page.evaluate(() => {
    const w = window as unknown as { __pointerdownListenerCount: number };
    w.__pointerdownListenerCount = 0;
    const originalAdd = document.addEventListener.bind(document);
    const originalRemove = document.removeEventListener.bind(document);
    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => {
      if (type === 'pointerdown') w.__pointerdownListenerCount += 1;
      return originalAdd(type, listener, options);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions
    ) => {
      if (type === 'pointerdown') w.__pointerdownListenerCount -= 1;
      return originalRemove(type, listener, options);
    }) as typeof document.removeEventListener;
  });
  const pointerdownListenerCount = () =>
    page.evaluate(() => (window as unknown as { __pointerdownListenerCount: number }).__pointerdownListenerCount);

  await suggestOrderCard.locator('[data-item-desc]').fill('Margherita groß');
  await suggestOrderCard.locator('[data-item-price]').fill('8,50');
  await suggestOrderCard.locator('[data-item-quantity]').fill('1');
  await suggestOrderCard.locator('[data-add-item-form] button[type="submit"]').click();
  await suggestOrderCard.locator('.food-order-item', { hasText: 'Margherita groß' }).waitFor();

  // Once the order has a position, the field gains the dropdown - opening it
  // via its toggle lists that exact existing description. Its render also
  // registered wireDescSuggest()'s document-level pointerdown listener,
  // alongside one for every other order-with-a-position card this shard's
  // earlier flows have left open on the same shared page - so this reads the
  // current count as a baseline instead of assuming a specific number.
  const descField = suggestOrderCard.locator('[data-desc-suggest]');
  await descField.waitFor();
  const afterFirstPosition = await pointerdownListenerCount();

  // renderFoodOrders() rebuilds the whole card - including this wrapper - on
  // every realtime re-render, so add two more positions via the API
  // (no click involved) to trigger two re-renders without any interaction.
  // Each one re-wires the currently visible order-with-a-position cards'
  // listeners while the old, now-detached wrappers' listeners are
  // deliberately *not* removed yet - cleanup is lazy, the same as the shared
  // search-select's own pattern - so the count should keep growing with
  // every render that has no click in between.
  const orderId = await suggestOrderCard.getAttribute('data-order-card');
  await page.request.post(`${BASE_URL}/api/food-orders/${orderId}/items`, {
    data: { playerId: alice.id, description: 'Wasser', quantity: 1 },
  });
  await suggestOrderCard.locator('.food-order-item', { hasText: 'Wasser' }).waitFor();
  const afterWasser = await pointerdownListenerCount();
  assert.ok(
    afterWasser > afterFirstPosition,
    'a re-render without any click should register at least one more pointerdown listener, not clean up the previous one'
  );

  await page.request.post(`${BASE_URL}/api/food-orders/${orderId}/items`, {
    data: { playerId: alice.id, description: 'Cola', quantity: 1 },
  });
  await suggestOrderCard.locator('.food-order-item', { hasText: 'Cola' }).waitFor();
  const afterCola = await pointerdownListenerCount();
  assert.ok(afterCola > afterWasser, 'a second re-render without any click should again grow the listener count, not stay flat');

  // A single pointerdown anywhere on the page must let every detached
  // wrapper's listener remove itself - before the fix nothing ever called
  // removeEventListener, so this count would only ever grow, unboundedly,
  // over a multi-day event.
  await page.click('h1.view-title');
  const afterClick = await pointerdownListenerCount();
  assert.ok(afterClick < afterCola, 'a single pointerdown must let the stale, detached listeners remove themselves again');

  // Typing filters the open list live. The option also carries the price it
  // was entered with, so it's visible before picking it.
  await descField.locator('[data-desc-toggle]').click();
  await page.waitForSelector('.food-order-desc-field .search-select-option:has-text("Margherita groß")');
  assert.match(
    (await page.locator('.food-order-desc-field .search-select-option', { hasText: 'Margherita groß' }).textContent()) ?? '',
    /8,50/
  );
  await descField.locator('[data-item-desc]').fill('marg');
  await page.waitForSelector('.food-order-desc-field .search-select-option:has-text("Margherita groß")');
  assert.equal(await descField.locator('.search-select-option').count(), 1);

  // Socket refreshes used to rebuild the open combobox continuously. Keep a
  // probe order in the newest cache until after the deferred render so the
  // test verifies both DOM stability and that the flush renders real data.
  const createRealtimeProbe = async (title: string) => {
    const refresh = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/food-orders' && response.request().method() === 'GET',
    );
    const response = await page.request.post(`${BASE_URL}/api/food-orders`, {
      data: { playerId: alice.id, title },
    });
    assert.equal(response.status(), 201, await response.text());
    const probe = await response.json() as { id: string };
    realtimeProbeOrderIds.push(probe.id);
    const refreshResponse = await refresh;
    assert.equal(refreshResponse.status(), 200);
    await refreshResponse.finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return probe.id;
  };

  await descField.evaluate((element) => { element.dataset.e2eInstance = 'outside-pointer'; });
  await createRealtimeProbe('Realtime-Render-Probe A');
  assert.equal(await descField.getAttribute('data-e2e-instance'), 'outside-pointer');

  // A realistic press must not let the pointerdown-close flush detach the
  // card toggle before pointerup/click. The first tap must collapse the card.
  const cardToggle = suggestOrderCard.locator('.food-order-card-header-toggle');
  await cardToggle.scrollIntoViewIfNeeded();
  const cardToggleBox = await cardToggle.boundingBox();
  assert.ok(cardToggleBox);
  await page.mouse.move(cardToggleBox.x + cardToggleBox.width / 2, cardToggleBox.y + cardToggleBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await suggestOrderCard.locator('.food-order-card-body').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('[data-desc-suggest][data-e2e-instance="outside-pointer"]') === null);
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe A' }).waitFor();

  await cardToggle.click();
  await suggestOrderCard.locator('.food-order-card-body').waitFor({ state: 'visible' });
  const descInput = descField.locator('[data-item-desc]');
  await descInput.fill('marg');
  await descField.evaluate((element) => { element.dataset.e2eInstance = 'suggestion-click'; });
  await createRealtimeProbe('Realtime-Render-Probe B');
  assert.equal(await descField.getAttribute('data-e2e-instance'), 'suggestion-click');
  assert.equal(await descField.locator('.search-select-option').count(), 1);

  await descField.locator('.search-select-option', { hasText: 'Margherita groß' }).click();
  assert.equal(await descField.locator('[data-item-desc]').inputValue(), 'Margherita groß');
  assert.equal(await suggestOrderCard.locator('[data-item-price]').inputValue(), '8,50');
  await page.waitForFunction(() => document.querySelector('[data-desc-suggest][data-e2e-instance="suggestion-click"]') === null);
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe B' }).waitFor();

  // Shift+Tab closes the list in keydown, then moves focus before the deferred
  // render replaces the card. The logically focused control must survive that
  // replacement instead of dropping focus back to the document body.
  await descInput.fill('marg');
  await descField.evaluate((element) => { element.dataset.e2eInstance = 'keyboard-tab'; });
  await createRealtimeProbe('Realtime-Render-Probe C');
  assert.equal(await descField.getAttribute('data-e2e-instance'), 'keyboard-tab');
  await descInput.press('Shift+Tab');
  await page.waitForFunction(() => document.querySelector('[data-desc-suggest][data-e2e-instance="keyboard-tab"]') === null);
  assert.equal(
    await page.evaluate(() => document.activeElement !== document.body && document.querySelector('#view-container')?.contains(document.activeElement)),
    true,
    'the deferred render must restore the meaningful food-order control reached by Shift+Tab'
  );
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe C' }).waitFor();

  for (const probeOrderId of realtimeProbeOrderIds) {
    const response = await page.request.delete(`${BASE_URL}/api/food-orders/${probeOrderId}`);
    assert.equal(response.status(), 204, await response.text());
  }
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe A' }).waitFor({ state: 'detached' });
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe B' }).waitFor({ state: 'detached' });
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe C' }).waitFor({ state: 'detached' });

  // This field is free text (the main supported case per the PR description
  // is typing something genuinely new), so an unmatched query keeps the list
  // closed instead of showing an empty-state box - on a phone that box would
  // sit right over the next field (quantity) and eat the tap meant for it.
  // Playwright's .click() itself fails if another element intercepts the
  // pointer at that point, so this also proves nothing is left overlapping.
  await descField.locator('[data-item-desc]').fill('xyz-nicht-vorhanden');
  assert.equal(await descField.evaluate((el) => el.classList.contains('is-open')), false);
  const quantityInput = suggestOrderCard.locator('[data-item-quantity]');
  await quantityInput.click();
  assert.equal(await quantityInput.evaluate((el) => el === document.activeElement), true);

  // Reopening with an empty query re-lists every suggestion. ArrowDown
  // activates the first option and sets aria-activedescendant; typing
  // further re-filters and must not leave that attribute pointing at an
  // option id that may no longer be in the (rebuilt) list.
  await descInput.fill('');
  await page.waitForSelector('.food-order-desc-field .search-select-option');
  await descInput.press('ArrowDown');
  assert.ok(await descInput.getAttribute('aria-activedescendant'));
  await descInput.press('a');
  assert.equal(await descInput.getAttribute('aria-activedescendant'), null);

  // A fresh open leaves no option pre-activated (activeIndex -1). ArrowUp
  // from that state must land on the alphabetically last suggestion
  // ("Wasser" of Cola/Margherita groß/Wasser) rather than skip past it, which
  // the plain wrap-around arithmetic otherwise does starting from -1.
  await descInput.fill('');
  await page.waitForSelector('.food-order-desc-field .search-select-option');
  await descInput.press('ArrowUp');
  await descInput.press('Enter');
  assert.equal(await descInput.inputValue(), 'Wasser');

  // Picking a suggestion reuses its exact spelling instead of whatever was
  // typed - the point being that the consolidated "Bestellübersicht" keeps
  // merging repeat orders of the same item into one row instead of splitting
  // it because someone spelled it slightly differently. It also syncs the
  // price field to the picked suggestion, overwriting whatever price happens
  // to already be typed for the new position.
  const priceInput = suggestOrderCard.locator('[data-item-price]');
  await priceInput.fill('1,00');
  await descInput.fill('marg');
  await descField.locator('.search-select-option', { hasText: 'Margherita groß' }).click();
  assert.equal(await descInput.inputValue(), 'Margherita groß');
  assert.equal(await priceInput.inputValue(), '8,50');

  // ...and just as reliably clears it again when the next picked suggestion
  // has no recorded price - a price auto-filled by an earlier pick must
  // never silently survive picking a different, price-less suggestion
  // afterwards.
  await descInput.fill('');
  await page.waitForSelector('.food-order-desc-field .search-select-option');
  await descInput.press('ArrowUp');
  await descInput.press('Enter');
  assert.equal(await descInput.inputValue(), 'Wasser');
  assert.equal(await priceInput.inputValue(), '');

  await descInput.fill('marg');
  await descField.locator('.search-select-option', { hasText: 'Margherita groß' }).click();
  assert.equal(await descInput.inputValue(), 'Margherita groß');
  assert.equal(await priceInput.inputValue(), '8,50');
  await suggestOrderCard.locator('[data-item-quantity]').fill('2');
  await suggestOrderCard.locator('[data-add-item-form] button[type="submit"]').click();

  await suggestOrderCard.locator('[data-open-order-list]').click();
  await page.waitForSelector('.modal h2:has-text("Bestellübersicht – Vorschlags-Test")');
  await page.waitForSelector('.food-order-consolidated-row:has-text("3 × Margherita groß")');
  await page.waitForSelector('.food-order-consolidated-row:has-text("1 × Wasser")');
  await page.waitForSelector('.food-order-consolidated-row:has-text("1 × Cola")');
  assert.equal(await page.locator('.food-order-consolidated-row').count(), 3);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });

  // The own-group delete is the only destructive bulk action and therefore
  // shows the full list before it can be confirmed.
  await suggestOrderCard.locator('[data-remove-group]').click();
  await page.waitForSelector('.modal h2:has-text("Deine 4 Positionen löschen?")');
  assert.equal(await page.locator('.food-order-confirm-list li').count(), 4);
  await page.click('[data-confirm-ok]');
  await page.waitForSelector('text=Noch keine Positionen.');
});

flowTest('Essensbestellung: marking a position paid does not scroll the Essen view back to the top', async () => {
  // Regression for the socket race behind the reported bug: PATCHing a
  // position's paid state makes the server broadcast foodOrders:changed to
  // every connected client, including the very device that just made the
  // change - often before that device's own fetch() promise has even
  // resolved. Handling that echo with a hard cache invalidate collapsed the
  // whole card list down to a one-line "Lädt…" placeholder for a moment,
  // which clamps .view-container's scrollTop to 0 - and it never recovered
  // once the real content came back (see refreshFoodOrders in
  // views/foodOrders.js, which now refetches quietly in place instead).
  await page.click('#nav-food-orders');
  await page.waitForSelector('#order-new-btn');
  await page.click('#order-new-btn');
  await page.fill('#order-title', 'Scroll-Test-Bestellung');
  await page.click('#order-form button[type="submit"]');
  await page.waitForSelector('text=Scroll-Test-Bestellung');

  // Scoped to this order's own card throughout: earlier food-order-shard
  // tests in this same file (shared page/session, see flowTest above) leave
  // their own orders open with their own live add-item forms on screen, so
  // bare page-level selectors here could hit the wrong order's form.
  const orderCard = page.locator('[data-order-card]', { hasText: 'Scroll-Test-Bestellung' });
  if (await orderCard.locator('.food-order-card-body').getAttribute('hidden') !== null) {
    await orderCard.locator('.food-order-card-header-toggle').click();
  }

  // Enough positions for the order card alone to overflow the phone
  // viewport's .view-container, so there is an actual scroll position to
  // lose.
  for (let i = 0; i < 15; i += 1) {
    await orderCard.locator('[data-item-desc]').fill(`Scrolltest-Artikel ${i}`);
    await orderCard.locator('[data-item-quantity]').fill('1');
    await orderCard.locator('[data-item-price]').fill('1,00');
    await orderCard.locator('[data-add-item-form] button[type="submit"]').click();
    // Once the order has at least one position, the description field grows
    // its own suggestion dropdown listing already-entered descriptions (see
    // renderDescField) - a bare text match would then also hit that
    // suggestion option, not just the newly added row itself.
    await orderCard.locator('.food-order-item', { hasText: `Scrolltest-Artikel ${i}` }).waitFor();
  }

  const viewContainer = page.locator('#view-container');
  assert.equal(
    await viewContainer.evaluate((el) => el.scrollHeight > el.clientHeight),
    true,
    'the Essen view must actually be scrollable for this test to be meaningful'
  );

  // Center the target position in the viewport ourselves (native
  // scrollIntoView, not Playwright's own actionability auto-scroll) so its
  // toggle is already fully visible - other food-order cards this shard's
  // earlier tests left on screen make "the very bottom of the page" an
  // unreliable stand-in for "this row's own position", and a Playwright
  // click that still had to nudge the page into view would move the exact
  // scroll position this test checks.
  const lastRow = orderCard.locator('.food-order-item', { hasText: 'Scrolltest-Artikel 14' });
  await lastRow.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const scrollTopBeforeToggle = await viewContainer.evaluate((el) => el.scrollTop);
  assert.ok(scrollTopBeforeToggle > 0);

  await lastRow.evaluate((row) => (row.closest('[data-order-card]')?.querySelector('[data-toggle-group-paid]') as HTMLElement | null)?.click());
  await orderCard.locator('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")').waitFor();
  // Give the realtime echo of this device's own change time to arrive and
  // (if the regression came back) trigger its reload.
  await page.waitForTimeout(300);

  const scrollTopAfterToggle = await viewContainer.evaluate((el) => el.scrollTop);
  assert.ok(
    scrollTopAfterToggle > scrollTopBeforeToggle - 4,
    `expected the scroll position to stay near ${scrollTopBeforeToggle}, was ${scrollTopAfterToggle}`
  );
});
