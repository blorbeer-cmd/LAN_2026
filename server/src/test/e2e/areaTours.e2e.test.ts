// Independent tour flows reuse the Core account setup in their own owner.
// Keeping them separate lets the existing runner overlap them with Shell
// checks without raising its file concurrency or dropping any tour steps.
import assert from 'node:assert/strict';
import type { Page, Request } from 'playwright';
import { addSessionCookie, finishE2EOnboarding } from './authHelpers';
import { trackE2EContext } from './e2eDiagnostics';
import { flowTest, registerFlowFixture, BASE_URL, page, browser, bob } from './flowsShared.fixture';
import { assertNoOverflow } from './visualHelpers';

registerFlowFixture('shell');

flowTest('manual area tours resume, restore focus, survive refresh and never submit product actions', async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(context, 'area-tours');
  t.after(async () => context.close());
  await finishE2EOnboarding(BASE_URL, bob.cookie);
  await addSessionCookie(context, BASE_URL, bob.cookie);
  const tourPage = await context.newPage();
  await tourPage.goto(`${BASE_URL}/#profile`);
  const help = tourPage.getByRole('button', { name: 'Mein Profil kennenlernen', exact: true });
  await help.waitFor();
  assert.equal(await tourPage.getByRole('heading', { name: 'Mein Profil', exact: true }).count(), 1);
  const originalScroll = await tourPage.locator('#view-container').evaluate((element) => element.scrollTop);
  assert.equal(await tourPage.locator('.area-tour-backdrop').count(), 0, 'visiting an area does not start a tour');
  const mutations: string[] = [];
  tourPage.on('request', (request) => {
    if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      mutations.push(`${request.method()} ${request.url()}`);
    }
  });
  await tourPage.evaluate(() => {
    document.documentElement.dataset.tourKeyCount = '0';
    const countGameKey = (event: KeyboardEvent) => {
      if (['ArrowLeft', ' ', 'Escape'].includes(event.key)) {
        document.documentElement.dataset.tourKeyCount = String(Number(document.documentElement.dataset.tourKeyCount) + 1);
      }
    };
    document.addEventListener('keydown', countGameKey);
    window.addEventListener('keydown', countGameKey);
  });
  const dismissFromText = async (selector: string) => {
    const dialog = tourPage.locator(selector);
    await dialog.locator('.modal-body > p, .area-tour-explanation p').first().click();
    assert.equal(await tourPage.evaluate(() => document.activeElement === document.body), true);
    await tourPage.keyboard.press('ArrowLeft');
    await tourPage.keyboard.press('Space');
    await tourPage.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await tourPage.evaluate(() => document.documentElement.dataset.tourKeyCount), '0',
      'chooser and tour keys stay out of document/window game controls after clicking text');
  };

  await help.click();
  await dismissFromText('.modal-backdrop');
  await help.click();
  await tourPage.getByRole('button', { name: 'Profil und Einstellungen: Starten', exact: true }).click();
  const overlay = tourPage.locator('.area-tour-backdrop');
  await overlay.getByRole('heading', { name: 'Dein Profil bearbeiten', exact: true }).waitFor();
  await overlay.dispatchEvent('pointerdown');
  await overlay.dispatchEvent('click');
  assert.equal(await overlay.isVisible(), true, 'a backdrop click must not end a running tour');
  assert.equal(await tourPage.locator('#app').evaluate((element) => (element as HTMLElement).inert), true);
  await overlay.locator('[data-tour-next]').click();
  await overlay.getByRole('heading', { name: 'Deine Ansicht wählen', exact: true }).waitFor();
  assert.match(await overlay.getByRole('status').textContent() ?? '', /Schritt 2 von .*Deine Ansicht wählen/u);
  await dismissFromText('.area-tour-backdrop');
  assert.equal(await tourPage.locator('#app').evaluate((element) => (element as HTMLElement).inert), false);
  assert.equal(await help.evaluate((element) => document.activeElement === element), true);
  assert.equal(await tourPage.locator('#view-container').evaluate((element) => element.scrollTop), originalScroll);

  await tourPage.reload();
  await help.click();
  await tourPage.getByRole('button', { name: 'Profil und Einstellungen: Fortsetzen', exact: true }).click();
  await overlay.getByRole('heading', { name: 'Deine Ansicht wählen', exact: true }).waitFor();
  // A real background rerender replaces the highlighted control, not the tour.
  await tourPage.evaluate(() => window.dispatchEvent(new Event('respawn:rerender')));
  await tourPage.waitForFunction(() => {
    const ring = document.querySelector('.area-tour-target');
    const input = document.querySelector('#profile-layout');
    return Boolean(ring && !ring.hasAttribute('hidden') && input &&
      Math.abs(ring.getBoundingClientRect().left - input.getBoundingClientRect().left) < 2);
  });
  for (const viewport of [{ width: 320, height: 568 }, { width: 1024, height: 768 }, { width: 512, height: 384 }]) {
    await tourPage.setViewportSize(viewport);
    await assertNoOverflow(overlay.locator('.modal'));
    assert.equal(await tourPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    const next = overlay.locator('[data-tour-next]');
    await next.focus();
    await tourPage.keyboard.press('Tab');
    assert.equal(await overlay.locator('[data-close]').evaluate((element) => document.activeElement === element), true);
    await tourPage.keyboard.press('Shift+Tab');
    assert.equal(await next.evaluate((element) => document.activeElement === element), true);
  }
  await tourPage.evaluate(() => {
    document.documentElement.dataset.tourKeyCount = '0';
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        document.documentElement.dataset.tourKeyCount = String(Number(document.documentElement.dataset.tourKeyCount) + 1);
      }
    });
  });
  await tourPage.keyboard.press('ArrowLeft');
  assert.equal(await tourPage.evaluate(() => document.documentElement.dataset.tourKeyCount), '0', 'tour keys stay out of game controls');
  assert.deepEqual(mutations, [], 'the explanatory tour must not send any product mutations');
  // Browser navigation remains available while the underlying app is inert.
  await tourPage.evaluate(() => { location.hash = '#foodOrders'; });
  await overlay.waitFor({ state: 'detached' });
  await tourPage.getByRole('button', { name: 'Essen kennenlernen', exact: true }).waitFor();
  assert.equal(await tourPage.locator('#app').evaluate((element) => (element as HTMLElement).inert), false);
});

flowTest('area tour examples work without live records and keep nested dialogs usable', async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(context, 'area-tour-examples');
  t.after(async () => context.close());
  await addSessionCookie(context, BASE_URL, bob.cookie);
  const tourPage = await context.newPage();
  await tourPage.goto(`${BASE_URL}/#foodOrders`);
  await tourPage.getByRole('button', { name: 'Essen kennenlernen', exact: true }).click();
  await tourPage.getByRole('button', { name: 'Bezahlen: Starten', exact: true }).click();
  const overlay = tourPage.locator('.area-tour-backdrop');
  const example = tourPage.frameLocator('[data-area-tour-scene]');
  const assertSceneReady = async (tourPage: Page) => {
    const overlay = tourPage.locator('.area-tour-backdrop');
    const example = tourPage.frameLocator('[data-area-tour-scene]');
    await tourPage.waitForFunction(() => ['ready', 'error'].includes(
      (document.querySelector('.area-tour-backdrop') as HTMLElement | null)?.dataset.tourSceneStatus ?? '',
    ));
    // Read one settled DOM snapshot instead of a separate browser round trip
    // for every property on every step. Keep all geometry and hit checks.
    const snapshot = await tourPage.evaluate(() => {
      const overlay = document.querySelector<HTMLElement>('.area-tour-backdrop')!;
      const frame = document.querySelector<HTMLIFrameElement>('[data-area-tour-scene]')!;
      const box = (element: Element | null) => {
        if (!element?.getClientRects().length) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const retry = overlay.querySelector<HTMLElement>('[data-tour-retry]')!;
      const retryBox = box(retry);
      const explanation = overlay.querySelector('.area-tour-explanation')!;
      const nativeDialog = Array.from(frame.contentDocument?.querySelectorAll('.modal-backdrop .modal') ?? []).at(-1) ?? null;
      return {
        status: overlay.dataset.tourSceneStatus,
        heading: overlay.querySelector('h2')!.textContent,
        text: overlay.textContent ?? '',
        nextLabel: overlay.querySelector('[data-tour-next]')!.textContent,
        frameBox: box(frame),
        retryVisible: Boolean(retryBox?.width && retryBox.height && getComputedStyle(retry).visibility === 'visible'),
        textFits: explanation.scrollHeight <= explanation.clientHeight + 1,
        actions: Array.from(overlay.querySelectorAll('.area-tour-actions button')).map((button) => {
          const rect = button.getBoundingClientRect();
          const panel = button.closest('.modal')!.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return rect.top >= panel.top && rect.bottom <= panel.bottom
            && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
            && (hit === button || button.contains(hit));
        }),
        hasNativeDialog: Boolean(nativeDialog),
        nativeDialogBox: box(nativeDialog),
        ringBox: box(overlay.querySelector('.area-tour-target')),
      };
    });
    const { heading, frameBox } = snapshot;
    assert.equal(snapshot.status, 'ready', `the actual example view must render: ${heading}`);
    const viewport = tourPage.viewportSize()!;
    assert.ok(frameBox && frameBox.x === 0 && frameBox.y === 0
      && frameBox.width === viewport.width && frameBox.height === viewport.height,
    'the example covers the complete viewport without compression or exposing the original page');
    assert.doesNotMatch(snapshot.text, /Beispielansicht/u);
    assert.equal(snapshot.retryVisible, false, 'a ready scene never offers an obsolete retry');
    assert.deepEqual(snapshot.actions, [true, true, true], `all navigation stays visible without scrolling at ${viewport.width} × ${viewport.height}`);
    assert.equal(snapshot.textFits, true, `the entire explanation stays readable at ${viewport.width} × ${viewport.height}`);
    if (heading === 'Die Antwortart beachten' || heading === 'Antwort speichern') {
      assert.equal(await example.locator('[data-poll-response="if_needed"]').count(), 2, 'the example demonstrates Passt/Notfalls/Nein');
      assert.equal(await example.locator('[data-save-poll]').isEnabled(), true, 'open feasibility options can be saved');
      const statuses = await example.locator('.event-poll-answer-chip').allTextContents();
      assert.ok(statuses.length > 0 && statuses.every((text) => /Deine Antwort fehlt/u.test(text)),
        'header and expanded card both report the incomplete answer');
    }
    if (heading === 'Was das Ergebnis auslöst') {
      const target = await example.locator('.bracket-tree-wrap').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      });
      const highlight = await example.locator('body').evaluate(() =>
        (window as unknown as { areaTourScene: { targetRect(): typeof target } }).areaTourScene.targetRect());
      assert.deepEqual(highlight, target, 'result effects highlight the real tournament bracket');
    }
    if (viewport.width === 800 && viewport.height === 500
      && (heading === 'Info öffnen' || ['Deine Mitteilungen', 'Zum Vorgang springen', 'Gelesen heißt noch offen', 'Obsolet oder abgelaufen', 'Push erlauben'].includes(heading ?? ''))) {
      const panel = await overlay.locator('.modal').boundingBox();
      const target = await overlay.locator('.area-tour-target').boundingBox();
      assert.ok(panel && target);
      const overlap = Math.max(0, Math.min(panel.x + panel.width, target.x + target.width) - Math.max(panel.x, target.x))
        * Math.max(0, Math.min(panel.y + panel.height, target.y + target.height) - Math.max(panel.y, target.y));
      const inset = 16;
      const room = target.y >= panel.height + inset * 2 || viewport.height - target.y - target.height >= panel.height + inset * 2
        || target.x >= panel.width + inset * 2 || viewport.width - target.x - target.width >= panel.width + inset * 2;
      if (room) assert.equal(overlap, 0, 'use free space when it fits the explanation and its navigation');
      else assert.ok(overlap < target.width * target.height, 'an unavoidable overlap must still leave part of the target visible');
    }
    if (heading === 'Bock übernehmen' || heading === 'Anonymität und Bock') {
      assert.equal(await example.locator('[data-vote-adopt-bock]').isVisible(), true);
      assert.equal(await example.locator('[data-vote-adopt-bock]').isChecked(), true);
    }
    if (heading === 'Captains auswählen') {
      assert.equal(await example.locator('[data-roster-picker="mm-captain-roster"] input:checked').count(), 2);
    }
    if (heading === 'Einladung prüfen') assert.equal(await example.locator('[data-accept-invitation="tour-invitation"]').isVisible(), true);
    if (heading === 'In deinen Kalender übernehmen') assert.equal(await example.locator('[data-action-menu="event-calendar-tour-event"] [data-event-calendar="google"]').isVisible(), true);
    if (heading === 'Warteschlange bearbeiten') assert.equal(await example.locator('[data-detail-remove]').isVisible(), true);
    if (heading === 'Playlist starten') assert.match(await example.locator('.modal-backdrop').textContent() ?? '', /Songwünsche werden ersetzt/u);
    if (heading === 'Deinen Anteil prüfen') {
      assert.equal(await example.locator('[data-desc-suggest].is-open').count(), 0, 'description suggestions must not cover the group');
      const group = example.locator('.food-order-group').first();
      assert.match(await group.textContent() ?? '', /17,60/u);
      const target = await group.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      });
      const highlight = await example.locator('body').evaluate(() =>
        (window as unknown as { areaTourScene: { targetRect(): typeof target } }).areaTourScene.targetRect());
      assert.deepEqual(highlight, target, 'the amount step highlights the whole own group including its total');
    }
    if (snapshot.hasNativeDialog) {
      const { nativeDialogBox: modalBox, ringBox } = snapshot;
      assert.ok(modalBox && ringBox, 'an open native dialog must have a visible highlight');
      const center = { x: ringBox.x + ringBox.width / 2, y: ringBox.y + ringBox.height / 2 };
      assert.ok(center.x >= modalBox.x && center.x <= modalBox.x + modalBox.width
        && center.y >= modalBox.y && center.y <= modalBox.y + modalBox.height,
      'the highlight belongs to the open native dialog, rather than its covered entry button');
    }
    return snapshot.nextLabel;
  };
  await assertSceneReady(tourPage);
  assert.match(await example.locator('body').textContent() ?? '', /Pizza bei Luigi/);
  assert.equal(await overlay.locator('input, iframe').count(), 0, 'the explanation dialog contains no imitation form or embedded example');
  await overlay.locator('[data-tour-end]').click();
  assert.equal(await tourPage.locator('[data-area-tour-scene]').count(), 0, 'ending the tour removes the demonstration document');
  await tourPage.locator('#info-btn').click();
  const info = tourPage.getByRole('dialog', { name: 'Info', exact: true });
  await info.getByRole('button', { name: 'Info kennenlernen', exact: true }).click();
  await tourPage.getByRole('button', { name: 'Tour starten', exact: true }).click();
  await overlay.locator('[data-tour-next]').waitFor();
  await tourPage.keyboard.press('Escape');
  await overlay.waitFor({ state: 'detached' });
  assert.equal(await info.isVisible(), true, 'closing the tour preserves the reference dialog');
  assert.equal(await info.getByRole('button', { name: 'Info kennenlernen', exact: true })
    .evaluate((element) => document.activeElement === element), true);
  await tourPage.keyboard.press('Escape');
  await info.waitFor({ state: 'detached' });

  // Empty workspaces still explain the actual create forms and example flow.
  // Real forms run in a separate document with no network writes or storage.
  const mutations: string[] = [];
  const demoNetwork: string[] = [];
  const flows = [
    { route: 'home', help: 'Home', chapter: 'Überblick: Starten', input: '', value: '', advance: 0 },
    { route: 'home', help: 'Home', chapter: 'Navigation und Event: Starten', input: '', value: '', advance: 0 },
    { route: 'home', help: 'Home', chapter: 'Mitteilungen: Starten', input: '', value: '', advance: 0 },
    { route: 'events', help: 'Events & Gruppen', chapter: 'Tour starten', input: '', value: '', advance: 0 },
    { route: 'music', help: 'Jam', chapter: 'Tour starten', input: '', value: '', advance: 0 },
    { route: 'broadcast', help: 'Durchsage', chapter: 'Tour starten', input: '#broadcast-message', value: 'Das Abendessen steht ab 19 Uhr in der Küche bereit.', advance: 0 },
    { route: 'matchmaking', help: 'Match', chapter: 'Turnier spielen: Starten', input: '', value: '', advance: 0 },
    { route: 'gameCatalog', help: 'Spiele', chapter: 'Bock, Skill und Auswahl: Starten', input: '', value: '', advance: 0 },
    { route: 'gameCatalog', help: 'Spiele', chapter: 'Spiele vorschlagen und pflegen: Starten', input: '#suggest-title', value: 'Deep Rock Galactic', advance: 0 },
    { route: 'votes', help: 'Vote', chapter: 'Abstimmen und Bock übernehmen: Starten', input: '#votes-title', value: 'Samstagabend', advance: 0 },
    { route: 'votes', help: 'Vote', chapter: 'Ergebnis, Stichwahl und Match: Starten', input: '', value: '', advance: 0 },
    { route: 'eventPolls', help: 'Umfragen', chapter: 'Umfrage verwalten: Starten', input: '#poll-title', value: 'Was essen wir am Samstag?', advance: 0 },
    { route: 'eventPolls', help: 'Umfragen', chapter: 'Antworten: Starten', input: '', value: '', advance: 0 },
    { route: 'checklist', help: 'To-Do', chapter: 'Tour starten', input: '#todo-title', value: 'Mehrfachsteckdosen', advance: 1 },
    { route: 'checklistPacking', help: 'Packliste', chapter: 'Tour starten', input: '', value: '', advance: 0 },
    { route: 'foodOrders', help: 'Essen', chapter: 'Bestellung organisieren: Starten', input: '#order-title', value: 'Pizza bei Luigi', advance: 0 },
    { route: 'foodOrders', help: 'Essen', chapter: 'Mitbestellen: Starten', input: '', value: '', advance: 0 },
    { route: 'foodOrders', help: 'Essen', chapter: 'Bezahlen: Fortsetzen', input: '', value: '', advance: 0 },
    { route: 'matchmaking', help: 'Match', chapter: 'Teams auslosen: Starten', input: '#mm-game-search', value: 'Rocket League', advance: 0 },
    { route: 'matchmaking', help: 'Match', chapter: 'Turnier erstellen: Starten', input: '#draw-tournament-format', value: 'single_elimination', advance: 0 },
    { route: 'matchmaking', help: 'Match', chapter: 'Captain Draft: Starten', input: '#mm-game-search', value: 'Rocket League', advance: 0 },
    { route: 'arrivals', help: 'An- & Abreise', chapter: 'Tour starten', input: '', value: '', advance: 2 },
  ];
  await tourPage.close();
  const flowPages = await Promise.all(Array.from({ length: 3 }, () => context.newPage()));
  const runFlow = async (flow: typeof flows[number], tourPage: Page) => {
    const overlay = tourPage.locator('.area-tour-backdrop');
    const example = tourPage.frameLocator('[data-area-tour-scene]');
    let nextLabel: string | null = null;
    const readyScene = async () => { nextLabel = await assertSceneReady(tourPage); };
    if (flow.route === 'home' && !flow.chapter.startsWith('Überblick')) await tourPage.setViewportSize({ width: 800, height: 500 });
    else if (flow.route === 'eventPolls' && flow.chapter.startsWith('Umfrage verwalten')) await tourPage.setViewportSize({ width: 1024, height: 768 });
    let recording = false;
    const recordRequest = (request: Request) => {
      if (request.frame() !== tourPage.mainFrame() && request.url().includes('/api/')) demoNetwork.push(request.url());
      if (recording && request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        mutations.push(`${request.method()} ${request.url()}`);
      }
    };
    tourPage.on('request', recordRequest);
    if (new URL(tourPage.url()).hash !== `#${flow.route}`) await tourPage.goto(`${BASE_URL}/#${flow.route}`);
    const help = tourPage.getByRole('button', { name: `${flow.help} kennenlernen`, exact: true });
    await help.waitFor();
    if (flow.route === 'arrivals') {
      await tourPage.locator('[data-arrivals-times]').waitFor({ state: 'attached' });
      await tourPage.locator('[data-arrivals-times]').evaluate((element) => { (element as HTMLDetailsElement).open = false; });
      await tourPage.locator('#arrival-note').fill('Mein ungespeicherter Entwurf');
    }
    recording = true;
    await help.click();
    await tourPage.getByRole('button', { name: flow.chapter, exact: true }).click();
    await readyScene();
    for (let step = 0; step < flow.advance; step += 1) {
      await overlay.locator('[data-tour-next]').click();
      await readyScene();
    }
    if (flow.input) {
      assert.equal(await example.locator(flow.input).inputValue(), flow.value);
    }
    if (flow.route === 'home' && flow.chapter.startsWith('Überblick')) {
      await example.locator('body').evaluate(() => {
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'area-tour:focus') document.body.dataset.testTourToken = event.data.token;
        });
      });
      await overlay.locator('[data-tour-next]').click();
      await readyScene();
      const focusExample = (target: string) => tourPage.evaluate((selector) => {
        const scene = document.querySelector<HTMLIFrameElement>('[data-area-tour-scene]')!.contentWindow!;
        scene.postMessage({ type: 'area-tour:focus', token: scene.document.body.dataset.testTourToken,
          step: 'overview/todos', target: selector }, location.origin);
      }, target);
      await focusExample('[data-missing-tour-target]');
      await tourPage.waitForFunction(() => document.querySelector<HTMLElement>('.area-tour-backdrop')?.dataset.tourSceneStatus === 'error');
      assert.equal(await overlay.locator('[data-tour-retry]').isVisible(), true, 'a missing target is reported instead of highlighting the first card');
      await focusExample('#home-todos-title');
      await tourPage.waitForFunction(() => document.querySelector<HTMLElement>('.area-tour-backdrop')?.dataset.tourSceneStatus === 'ready');
      await readyScene();
    }
    if (flow.route === 'gameCatalog') {
      const node = await tourPage.locator('[data-area-tour-scene]').elementHandle();
      const scene = await node!.contentFrame();
      await scene!.evaluate(() => {
        document.body.dataset.continuity = 'same-document';
        const input = document.querySelector<HTMLInputElement>('#suggest-title');
        if (input) input.value = 'Mein Tourentwurf';
      });
      await overlay.locator('[data-tour-next]').click();
      await readyScene();
      if (!flow.input) {
        // Bock → Skill only changes the highlight, even after resizing.
        await tourPage.setViewportSize({ width: 1440, height: 900 });
        await overlay.locator('[data-tour-next]').click();
        await readyScene();
        const geometry = await tourPage.evaluate(() => {
          const child = document.querySelector<HTMLIFrameElement>('[data-area-tour-scene]')!.contentWindow!;
          const properties = ['font-size', 'padding-left', 'padding-right', 'max-width'];
          const read = (win: Window, selector: string) => properties.map((property) =>
            win.getComputedStyle(win.document.querySelector(selector)!).getPropertyValue(property));
          return ['#view-container', '.topbar'].map((selector) => ({
            original: read(window, selector), example: read(child, selector),
          }));
        });
        for (const values of geometry) assert.deepEqual(values.example, values.original,
          'the demo uses the same text size, padding and content width as the actual app');
      }
      assert.equal(await scene!.evaluate(() => document.body.dataset.continuity), 'same-document');
      assert.equal(await tourPage.locator('[data-area-tour-scene]').evaluate((el, original) => el === original, node), true,
        'focus-only steps preserve the actual document and its form state');
      if (flow.input) assert.equal(await example.locator('#suggest-title').inputValue(), 'Mein Tourentwurf');
      await tourPage.setViewportSize({ width: 390, height: 844 });
    }
    if (flow.route === 'home' && flow.chapter.startsWith('Navigation')) {
      assert.equal(await example.locator('#demo-event-list').isVisible(), true);
    }
    if (flow.route === 'home' && flow.chapter.startsWith('Mitteilungen')) {
      assert.equal(await example.locator('.notification-center-entry').count(), 2);
    }
    if (flow.route === 'matchmaking' && flow.chapter.startsWith('Turnier spielen')) {
      assert.equal(await example.locator('.bracket-match').count(), 3);
      const target = await example.locator('[data-tournament-teams]').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      });
      const highlight = await example.locator('body').evaluate(() =>
        (window as unknown as { areaTourScene: { targetRect(): typeof target } }).areaTourScene.targetRect());
      assert.deepEqual(highlight, target, 'the first tournament step highlights the team overview');
      assert.equal(await example.locator('[data-tournament-teams]').evaluate((element) => (element as HTMLDetailsElement).open), true);
    }
    if (flow.route === 'music') {
      assert.match(await example.locator('body').textContent() ?? '', /LAN-Nacht/u);
    }
    if (flow.route === 'votes' && flow.input) {
      const frame = await tourPage.locator('[data-area-tour-scene]').elementHandle();
      const demoFrame = await frame!.contentFrame();
      assert.equal(await demoFrame!.evaluate(async () => (await fetch('/api/votes/start', { method: 'POST' })).status), 405);
      await demoFrame!.evaluate(() => { localStorage.setItem('area-tour-isolation-test', 'demo'); });
      assert.equal(await tourPage.evaluate(() => localStorage.getItem('area-tour-isolation-test')), null);
      for (let step = 0; step < 7; step += 1) {
        await overlay.locator('[data-tour-next]').click();
        await readyScene();
      }
      assert.match(await example.locator('.event-poll-answer-chip').first().textContent() ?? '', /Abgegeben/);
    }
    if (flow.route === 'arrivals') {
      assert.equal(await example.locator('[data-arrivals-times]').evaluate((element) => (element as HTMLDetailsElement).open), true);
      assert.equal(await tourPage.locator('[data-arrivals-times]').evaluate((element) => (element as HTMLDetailsElement).open), false,
        'the original section remains unchanged while the example is open');
    }
    if (flow.route === 'matchmaking' && flow.chapter.startsWith('Captain Draft')) {
      const roster = await example.locator('[data-roster-picker="mm-draft-roster"]').elementHandle();
      for (const action of ['next', 'next', 'back', 'next']) {
        await overlay.locator(`[data-tour-${action}]`).click();
        await readyScene();
        assert.equal(await example.locator('[data-roster-picker="mm-draft-roster"]').evaluate((element, original) => element === original, roster), true,
          'draft preparation preserves the same player roster when moving forward and back');
      }
    }
    // Walk every remaining state of this chapter, including real detail,
    // payment/confirmation, result and tournament dialogs.
    for (let step = 0; step < 20 && nextLabel !== 'Abschließen'; step += 1) {
      await overlay.locator('[data-tour-next]').click();
      await readyScene();
    }
    if (flow.route === 'home' && flow.chapter.startsWith('Überblick')) {
      assert.equal(await example.locator('#home-event-overview-title').textContent(), 'Eventübersicht');
      assert.equal(await example.locator('[data-home-event-overview] strong').first().textContent(), 'Sommerfest');
      assert.equal(await example.locator('#demo-event-search').inputValue(), 'Sommerfest',
        'the event overview and selected header event must agree');
    }
    await overlay.locator('[data-tour-end]').click();
    await overlay.waitFor({ state: 'detached' });
    assert.equal(await tourPage.locator('[data-area-tour-scene]').count(), 0);
    // Removing the overlay is not the focus-restoration acknowledgement.
    // Wait for the actual keyboard destination before asserting it.
    await tourPage.waitForFunction((element) => document.activeElement === element, await help.elementHandle());
    assert.equal(await help.evaluate((element) => document.activeElement === element), true);
    if (flow.route === 'arrivals') {
      assert.equal(await tourPage.locator('[data-arrivals-times]').evaluate((element) => (element as HTMLDetailsElement).open), false,
        'ending restores the original collapsed section');
      assert.equal(await tourPage.locator('#arrival-note').inputValue(), 'Mein ungespeicherter Entwurf');
    }
    recording = false;
    await tourPage.setViewportSize({ width: 390, height: 844 });
    tourPage.off('request', recordRequest);
  };
  // These chapters have no server writes and independent page/form state.
  // Reuse three SPA tabs, giving each its next chapter as soon as it is free
  // instead of idling behind the longest chapter in a fixed batch.
  let nextFlow = 0;
  const results = await Promise.allSettled(flowPages.map(async (tourPage) => {
    for (;;) {
      const flow = flows[nextFlow++];
      if (!flow) return;
      await runFlow(flow, tourPage);
    }
  }));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
  await Promise.all(flowPages.map((flowPage) => flowPage.close()));
  // Management cards differ from member invitation cards. Reuse the already
  // authenticated admin tab and exercise its whole participation chapter too.
  await runFlow({ route: 'events', help: 'Events & Gruppen', chapter: 'Teilnehmen, Kalender und Beitrag: Starten', input: '', value: '', advance: 0 }, page);
  assert.deepEqual(mutations, [], 'example dialogs and rows must not create or change product records');
  assert.deepEqual(demoNetwork, [], 'the real views in a demonstration must not read or write the live API');
});
