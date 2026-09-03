// Browser E2E test, competition shard: players, matchmaking, voting and evaluations.
// One owner process drives the real built server + real Chromium; the shared
// server session, browser context and page live in ./flowsShared.fixture.
// Sibling tests here intentionally share that state and run in order.

import assert from 'node:assert/strict';
import { createE2EAccount } from './authHelpers';
import {
  flowTest,
  registerFlowFixture,
  BASE_URL,
  page,
  adminCookie,
  alice,
  openMatchmakingHistory,
  openTeams,
  openAuswertungTab,
  ensureAdminMode,
} from './flowsShared.fixture';

registerFlowFixture('competition');

flowTest('full click-through: players, matchmaking, voting, leaderboard, live pause', async (t) => {
  // This test starts a vote round partway through and only cancels it via UI
  // clicks much later, once its own assertions along the way all pass. If
  // one of those throws first, the round is left open for the rest of the
  // shared page/session — the later "Aktuell" test then times out because it
  // expects the idle "start a round" form, not an already-open round. Cancel
  // any round left open directly through the API, bypassing whatever UI
  // state the test aborted in, so a failure here can't cascade like that.
  t.after(async () => {
    const current = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
    if (current.open) await page.request.post(`${BASE_URL}/api/votes/cancel`);
  });
  // The separate "Spieler" area is gone: Home's Live-Status is the roster and
  // every card opens that participant's profile. Identities are still created
  // through the API that future user management will own.
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('button[data-player]:has-text("E2E Bob")');

  // The live state (badge text) is part of the button's accessible name, not
  // hidden inside presentational children — role=button treats descendants as
  // presentational, so an aria-label alone would have silently dropped it.
  const bobCard = page.locator('button[data-player]', { hasText: 'E2E Bob' });
  const bobBadgeText = (await bobCard.locator('.badge').innerText()).trim();
  assert.ok(
    (await bobCard.getAttribute('aria-label'))?.includes(bobBadgeText),
    'the live-status badge text must be part of the card\'s accessible name',
  );

  // Other profiles are read-only; the current identity opens its own editor.
  await page.click('button[data-player] >> text=E2E Bob');
  await page.waitForSelector('.modal:has-text("E2E Bob")');
  assert.equal(await page.getByText('Dieses Profil kann nur von E2E Bob selbst bearbeitet werden.', { exact: true }).count(), 0);
  assert.equal(await page.locator('#detail-save, #detail-delete, #detail-apikey').count(), 0);
  await page.click('[data-close]');
  await page.click('button[data-player] >> text=E2E Alice');
  await page.waitForSelector('#profile-name');
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');

  // Matchmaking: draw teams for both players.
  await openTeams();
  assert.equal(await page.inputValue('#mm-teamcount'), '2');
  await page.click('[data-selection-search-trigger][aria-controls="mm-player-search"]');
  await page.fill('#mm-player-search', 'E2E Bob');
  await page.waitForFunction(() => document.querySelectorAll('[data-mm-draw-search-item]:not([hidden])').length === 1);
  assert.equal(await page.locator('[data-mm-draw-search-item]:not([hidden])').getByText('E2E Bob', { exact: true }).count(), 1);
  await page.click('#mm-select-none');
  assert.equal(await page.locator('[data-mm-draw-search-item]:not([hidden]) [data-player]:checked').count(), 0);
  assert.equal(
    await page.locator('[data-mm-draw-search-item][hidden] [data-player]:checked').count(),
    1,
    'filtering must not clear a hidden player selection',
  );
  await page.click('[data-selection-search]:has(#mm-player-search) [data-selection-search-close]');
  await page.click('#mm-select-none');
  assert.equal(await page.locator('[data-player]:checked').count(), 0);
  await page.click('#mm-select-all');
  assert.equal(await page.locator('[data-player]:checked').count(), 2);
  assert.equal(await page.locator('details.history-details:has(summary:has-text("Historie"))').getAttribute('open'), null);

  // Player cards (checkbox, avatar, name, skill value) stack in a single
  // column on phones; two columns would leave no readable room for names.
  const drawPlayerGrid = page.locator('section[aria-labelledby="matchmaking-draw-title"] .player-selection-grid');
  const mobileSelectionColumns = await drawPlayerGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  );
  assert.equal(mobileSelectionColumns, 1);
  await page.setViewportSize({ width: 900, height: 844 });
  const desktopSelectionColumns = await drawPlayerGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  );
  assert.ok(desktopSelectionColumns >= 2);
  await page.setViewportSize({ width: 390, height: 844 });

  // Only the selected mode's section renders — switch to Captain Draft to
  // reach its tooltip, then back to Auslosung to reach "Teams auslosen".
  await page.click('[data-mm-mode="draft"]');
  assert.equal(await page.locator('#draft-player-search').count(), 1);
  await page.click('[data-selection-search-trigger][aria-controls="captain-player-search"]');
  await page.fill('#captain-player-search', 'E2E Alice');
  await page.waitForFunction(() => document.querySelectorAll('[data-mm-captain-search-item]:not([hidden])').length === 1);
  assert.equal(await page.locator('[data-mm-captain-search-item]:not([hidden])').getByText('E2E Alice', { exact: true }).count(), 1);
  await page.click('[data-selection-search]:has(#captain-player-search) [data-selection-search-close]');
  const draftHelp = page.locator('[aria-controls="captain-draft-help"]');
  await draftHelp.waitFor();
  await draftHelp.click();
  assert.equal(await draftHelp.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await draftHelp.getAttribute('aria-expanded'), 'false');

  await page.click('[data-mm-mode="draw"]');
  await page.waitForSelector('#mm-generate');
  // The sticky action bar must not steal clicks from rows scrolling behind
  // it: only real controls (the button here) opt back into pointer events,
  // the bar's own background stays pass-through (see .sticky-actions in
  // style.css).
  const stickyActions = page.locator('.sticky-actions', { has: page.locator('#mm-generate') });
  assert.equal(await stickyActions.evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
  assert.equal(await page.locator('#mm-generate').evaluate((el) => getComputedStyle(el).pointerEvents), 'auto');
  await page.click('#mm-generate');
  await page.waitForSelector('.team-card');
  const teamCards = await page.locator('.team-card').count();
  assert.ok(teamCards >= 2, 'expected at least 2 team cards');

  // Neither of these two players rated the game, so both enter the draw with
  // the server's neutral fallback. That has to stay visible: each row shows
  // the parenthesized fallback, and every team header's total is the sum of
  // its own visible rows plus the count of unrated players.
  assert.ok((await page.locator('.team-card .team-player .rating-unrated').count()) > 0);
  const drawnTeams = await page.locator('.team-card').evaluateAll((cards) =>
    cards.map((card) => ({
      header: card.querySelector('.team-skill-total')?.textContent?.trim() ?? '',
      players: Array.from(card.querySelectorAll('.team-player .rating')).map(
        (row) => row.textContent?.trim() ?? ''
      ),
    }))
  );
  for (const team of drawnTeams) {
    const ratings = team.players.map((text) => Number(text.replace(/[()]/g, '')));
    const [total, unratedCount] = team.header.replace(/[()]/g, ' ').trim().split(/\s+/).map(Number);
    assert.equal(
      total,
      ratings.reduce((sum, rating) => sum + rating, 0)
    );
    assert.equal(unratedCount ?? 0, team.players.filter((text) => text.startsWith('(')).length);
  }

  // Voting: start a round (points mode, the only mode offered when starting
  // fresh), rate a game, and submit. Alice's personal session already fixes
  // the voter identity, so no extra identity form appears. Moving a slider only
  // stages a local draft — it must not count as a vote until the submit
  // button is pressed. While the round is open, no per-game distribution
  // (bars/counts) may be visible anywhere — only total participation and the
  // voter's own pick.
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-start');
  assert.equal(await page.getByText('Du bist E2E Alice', { exact: true }).count(), 0);
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close'); // only rendered once the round shows as open
  await page.waitForSelector('.vote-participation-status:has-text("Bewertungen abgegeben"):has-text("0 / 2")');
  // Opening the round also kicks off votes.js's own follow-up mine/history
  // fetches, each of which rerenders (replacing this whole section) again
  // once it resolves. Settling on network idle first, then reading all
  // three boxes from one synchronous evaluate(), avoids one of those
  // rerenders landing between three separate boundingBox() round trips and
  // handing back a stale/zero-size box for whichever button it replaced.
  await page.waitForLoadState('networkidle');
  const { submitWidth, closeWidth, cancelWidth } = await page.evaluate(() => ({
    submitWidth: document.querySelector('#votes-submit')?.getBoundingClientRect().width ?? 0,
    closeWidth: document.querySelector('#votes-close')?.getBoundingClientRect().width ?? 0,
    cancelWidth: document.querySelector('#votes-cancel')?.getBoundingClientRect().width ?? 0,
  }));
  assert.ok(submitWidth > closeWidth);
  assert.equal(Math.round(cancelWidth), Math.round(closeWidth));
  assert.equal(await page.locator('.vote-game-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
  await page.setViewportSize({ width: 900, height: 844 });
  assert.equal(await page.locator('.vote-game-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'no bars while the round is open');
  await page.locator('[data-points-slider] >> nth=0').evaluate((el) => {
    (el as HTMLInputElement).value = '5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('[data-points-slider] >> nth=1').evaluate((el) => {
    (el as HTMLInputElement).value = '5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForSelector('.skill-value:text("5")'); // staged locally
  assert.equal(
    await page.locator('.vote-participation-status:has-text("0 / 2")').count(),
    1,
    'moving a slider must not submit it by itself'
  );

  // Own rating progress and the "Unbewertet" filter reflect the two just-
  // staged (not yet submitted) picks against the round's full game count.
  const totalGames = await page.locator('[data-points-slider]').count();
  await page.waitForSelector(`.vote-workflow-section >> text=2 von ${totalGames} bewertet`);
  await page.click('#votes-unrated-toggle');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-points-slider]').length === expected,
    totalGames - 2
  );
  await page.click('#votes-unrated-toggle');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-points-slider]').length === expected,
    totalGames
  );

  await page.click('#votes-submit');
  await page.waitForSelector('.vote-participation-status:has-text("1 / 2")');
  await page.waitForSelector('.vote-submitted-state:has-text("Bewertung abgegeben")');
  assert.equal(await page.locator('#votes-submit').count(), 0);
  assert.ok(await page.locator('[data-points-slider]').first().isDisabled());
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'still no bars after casting, before closing');

  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
  // Closing reveals only games that actually received points in the compact
  // "Letzter Vote" group; the detail modal applies the same zero-score filter.
  await page.waitForSelector('text=Letzter Vote');
  await page.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="vote-current-result-title"] .lb-row').length >= 2);
  const currentVote = page.locator('section[aria-labelledby="vote-current-result-title"]');
  assert.equal(await currentVote.locator('.lb-row').count(), 2);
  assert.equal(await currentVote.locator('.lb-row.is-tied').count(), 2);
  assert.deepEqual(await currentVote.locator('.lb-row.is-tied .lb-rank').allTextContents(), ['1', '1']);
  assert.equal(await currentVote.getByText('Unentschieden', { exact: true }).count(), 0);
  assert.equal(await currentVote.locator('#votes-runoff').count(), 1, 'the runoff action belongs to the current Vote card');
  assert.equal(await page.locator('section[aria-labelledby="vote-runoff-title"]').count(), 0, 'no separate runoff card remains');
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'no bars on the main page, even after closing');
  assert.equal(await page.locator('details.history-details:has(summary:has-text("Historie"))').getAttribute('open'), null);

  // The just-closed round can be reopened from the history list for the
  // full detailed breakdown.
  await page.click('details.history-details:has(summary:has-text("Historie")) > summary');
  await page.waitForFunction(() => document.querySelectorAll('.vote-history-round .lb-row').length >= 2);
  assert.equal(await page.locator('.vote-history-round').first().locator('.lb-row').count(), 2);
  await page.click('[data-open-history-round]');
  await page.waitForSelector('text=Abstimmung Runde 1');
  await page.waitForSelector('.modal .vote-bar-track');
  assert.equal(await page.locator('.modal .vote-row').count(), 2);
  await page.click('[data-close]');

  // Admin mode stays active from here for the rest of this shard's shared
  // page/session (test players, Arcade AI). Auswertung itself no longer
  // depends on it - it lives behind Admin's own "Auswertung" tool card,
  // gated by the real admin role instead.
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await ensureAdminMode();

  // Leaderboard: record a match and see it reflected.
  await page.click('[data-navigate="leaderboard"]');
  await page.waitForSelector('h1:text-is("Auswertung")');
  await page.waitForSelector('[data-section-tab="leaderboard"][aria-current="page"]');
  assert.equal(
    await page.locator('section.grouped-page-section:has(> .grouped-page-section-title > h2:text-is("Rangliste & Spielzeit"))').count(),
    1,
    'filtered ranking and playtime should share one grouped section'
  );
  for (const title of ['Rangliste', 'Spielzeit']) {
    assert.equal(
      await page.locator(`section[aria-labelledby="leaderboard-filtered-title"] section.tournament-section-panel:has(h2:text-is("${title}"))`).count(),
      1,
      `${title} should remain an accented subsection`
    );
  }
  assert.equal(
    await page.locator('section.grouped-page-section:has(> .grouped-page-section-title > h2:text-is("Spielzeit pro Spiel"))').count(),
    1,
    'per-game playtime should remain a separate grouped section'
  );
  assert.equal(
    await page.locator('section[aria-labelledby="leaderboard-filtered-title"] #lb-filter').count(),
    1,
    'the game filter belongs to the shared filtered section'
  );
  for (const grid of await page.locator('.leaderboard-list-grid').all()) {
    assert.equal(
      await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
      1,
      'leaderboard lists should stay single-column on phones'
    );
  }
  await page.setViewportSize({ width: 900, height: 844 });
  for (const grid of await page.locator('.leaderboard-list-grid').all()) {
    assert.equal(
      await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
      2,
      'leaderboard lists should use two columns when space is available'
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // #lb-filter is a searchable combobox (searchSelect.js), not a native
  // <select>: typing an option's exact label into #lb-filter-search resolves
  // the hidden #lb-filter input to that game's id, just like choosing it from
  // the app-rendered listbox.
  const gamesRes = await page.request.get(`${BASE_URL}/api/games`);
  const games = await gamesRes.json();
  const filteredGame = games[1];
  assert.ok(filteredGame);
  const filteredGameId = filteredGame.id;
  const [filteredPlaytimeResponse, allPlaytimeResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/stats/playtime' && url.searchParams.get('gameId') === filteredGameId;
    }),
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/stats/playtime' && !url.searchParams.has('gameId');
    }),
    page.fill('#lb-filter-search', filteredGame.name),
  ]);
  assert.equal(filteredPlaytimeResponse.ok(), true, 'per-player playtime should follow the selected game');
  assert.equal(allPlaytimeResponse.ok(), true, 'per-game playtime should keep loading all games');
  await page.click('#add-match-btn');
  await page.waitForSelector('#match-players');
  assert.deepEqual(
    await page.locator('#match-form .match-form-section h2').allTextContents(),
    ['Modus', 'Spieler-Zuordnung', 'Ergebnis']
  );
  assert.equal(
    await page.locator('#match-form').evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
    'the result form should not overflow at phone width'
  );
  await page.check('#match-advanced');
  assert.equal(await page.locator('.match-result-row').count(), 2);
  assert.equal(
    await page.locator('#match-form').evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
    'advanced result fields should remain inside the result group'
  );
  // The "Wert" field uses step="any" (arbitrary decimal scores) while "Platz"
  // uses the default whole-number step — native stepUp()/stepDown() throws on
  // a step="any" field, so the shared numberStepper.js click handler needs
  // its own fallback there instead of silently doing nothing.
  await page.click('[data-team-score="0"] + .number-stepper-steps .number-stepper-btn[aria-label="Wert erhöhen"]');
  assert.equal(await page.locator('[data-team-score="0"]').inputValue(), '1');
  await page.click('[data-team-rank="0"] + .number-stepper-steps .number-stepper-btn[aria-label="Wert erhöhen"]');
  assert.equal(await page.locator('[data-team-rank="0"]').inputValue(), '1');
  await page.uncheck('#match-advanced');
  const teamSelects = page.locator('[data-team-for]');
  await teamSelects.nth(0).selectOption('0');
  await teamSelects.nth(1).selectOption('1');
  await page.check('input[name="winner"][value="0"]');
  await page.click('#match-form button[type="submit"]');
  await page.waitForSelector('.lb-row');
  assert.ok((await page.locator('.lb-row').count()) >= 2);
  // The app can render its first data view before the stylesheet request has
  // completed on a cold CI browser. Wait for the actual sheet and a resolved
  // body font before comparing typography across views.
  await page.waitForFunction(() => {
    const stylesheet = document.querySelector('link[href*="/css/style.css"]') as HTMLLinkElement | null;
    return stylesheet?.sheet !== null && getComputedStyle(document.body).fontFamily !== '';
  });
  // Read the styles off a freshly queried node at evaluation time: a
  // players:/live:changed refresh can re-render the list between resolving a
  // locator handle and evaluating it, and a detached node reports every
  // computed style as ''. Retry until a live node answers.
  const readNameTypography = (selector: string) =>
    page
      .waitForFunction((sel) => {
        const element = document.querySelector(sel);
        if (!element) return null;
        const style = getComputedStyle(element);
        if (!style.fontFamily) return null;
        return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
      }, selector)
      .then((result) => result.jsonValue() as Promise<{ family: string; size: string; weight: string }>);
  const leaderboardNameTypography = await readNameTypography('.lb-row .player-name');
  await page.waitForSelector('text=Spielzeit');

  // Back to Home: should now show both players (offline, since no agent ran).
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('.player-card');
  assert.equal(await page.locator('.player-card').count(), 2);
  for (const title of ['Live-Status', 'Rangliste', 'Sitzplan']) {
    assert.equal(
      await page.locator(`section.grouped-page-section:has(h2:text-is("${title}"))`).count(),
      1,
      `${title} should be presented as a grouped Home section`
    );
  }
  const liveNameTypography = await readNameTypography('.player-card .player-name');
  assert.deepEqual(liveNameTypography, leaderboardNameTypography, 'player names should use one shared typography');
  await page.setViewportSize({ width: 900, height: 844 });
  assert.equal(
    await page.locator('.home-leaderboard-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    2,
    'home leaderboard should use two columns when the card has enough width'
  );
  await page.setViewportSize({ width: 390, height: 844 });

  // Manual pause override (FR-28): the pause toggle lives in the "Dein
  // Status" bar, not on the player's own tile. Toggle pause, see the badge
  // flip, then toggle back.
  assert.equal((await page.locator('[data-toggle-pause]').textContent())?.trim(), 'Pause');
  await page.click('[data-toggle-pause]');
  await page.waitForSelector('.badge-paused');
  assert.equal((await page.locator('[data-toggle-pause]').textContent())?.trim(), 'Bin wieder da');
  await page.click('[data-toggle-pause]');
  await page.waitForFunction(() => !document.querySelector('.badge-paused'));
});

flowTest('Vote: game-limit selection survives an unrelated re-render and select-all/none ignore prior manual state', async () => {
  // Regression test: the game-selection checkboxes used to live only in the
  // DOM with no persisted JS state. A votes:changed/preferences:changed
  // socket event re-renders this whole view from scratch whenever *anyone*
  // interacts with voting elsewhere — that silently cleared manual
  // deselections. `respawn:rerender` is the same generic re-render signal
  // the app itself dispatches; firing it here simulates that unrelated
  // event without needing a second browser context.
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-start');
  await page.waitForSelector('#votes-game-select-wrap:not([hidden])');
  const initialVoteState = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
  const catalogGames = (await (await page.request.get(`${BASE_URL}/api/games`)).json()) as Array<{
    id: string;
    name: string;
    isSuggestion?: boolean;
  }>;
  const counterStrike = catalogGames.find((game) => game.name === 'Counter-Strike 2')!;
  const catalogGameIds = new Set(catalogGames.filter((game) => !game.isSuggestion).map((game) => game.id));
  const preferenceByGameId = new Map<string, number>(
    initialVoteState.catalogResults.map(
      (result: { gameId: string; avgPreference: number | null }): [string, number] => [
        result.gameId,
        result.avgPreference ?? -1,
      ],
    ),
  );
  const expectedVoteOrder = catalogGames
    .filter((game) => catalogGameIds.has(game.id))
    .sort((a, b) => {
      const preferenceDiff = (preferenceByGameId.get(b.id) ?? -1) - (preferenceByGameId.get(a.id) ?? -1);
      return preferenceDiff !== 0 ? preferenceDiff : a.name.localeCompare(b.name, 'de');
    })
    .map((game) => game.id);
  const renderedVoteOrder = await page.locator('[data-vote-game-checkbox]').evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).value),
  );
  assert.deepEqual(renderedVoteOrder, expectedVoteOrder, 'the vote game list should be sorted by Bock level');
  let initiallySelected = await page.locator('[data-vote-game-checkbox]:checked').evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).value),
  );
  assert.deepEqual(
    initiallySelected,
    expectedVoteOrder.slice(0, 10),
    'the initial vote selection should contain the current Top 10 by Bock level',
  );

  // A live Bock update while the idle form is still untouched must refresh
  // the automatic Top-10 selection together with the visible sort order.
  // Preserve the fixture's previous rating so later scenarios stay isolated.
  if (expectedVoteOrder.length > 10) {
    const liveBockTarget = expectedVoteOrder[expectedVoteOrder.length - 1];
    const previousPreferenceResponse = await page.request.get(
      `${BASE_URL}/api/preferences?playerId=${alice.id}&gameId=${liveBockTarget}`,
    );
    const previousPreferences = (await previousPreferenceResponse.json()) as Array<{ rating: number }>;
    const previousRating = previousPreferences[0]?.rating;
    const updatedPreference = await page.request.put(`${BASE_URL}/api/preferences`, {
      data: { playerId: alice.id, gameId: liveBockTarget, rating: 10 },
    });
    assert.equal(updatedPreference.status(), 200, await updatedPreference.text());
    await page.waitForFunction((targetId) => {
      const checkbox = document.querySelector(`[data-vote-game-checkbox][value="${targetId}"]`) as HTMLInputElement | null;
      return checkbox?.checked === true;
    }, liveBockTarget);

    const liveVoteState = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
    const livePreferenceByGameId = new Map<string, number>(
      liveVoteState.catalogResults.map(
        (result: { gameId: string; avgPreference: number | null }): [string, number] => [
          result.gameId,
          result.avgPreference ?? -1,
        ],
      ),
    );
    const liveExpectedVoteOrder = catalogGames
      .filter((game) => catalogGameIds.has(game.id))
      .sort((a, b) => {
        const preferenceDiff = (livePreferenceByGameId.get(b.id) ?? -1) - (livePreferenceByGameId.get(a.id) ?? -1);
        return preferenceDiff !== 0 ? preferenceDiff : a.name.localeCompare(b.name, 'de');
      })
      .map((game) => game.id);
    const liveSelected = await page.locator('[data-vote-game-checkbox]:checked').evaluateAll((els) =>
      els.map((el) => (el as HTMLInputElement).value),
    );
    assert.deepEqual(
      liveSelected,
      liveExpectedVoteOrder.slice(0, 10),
      'a live Bock update should refresh the untouched Top-10 selection',
    );

    if (previousRating === undefined) {
      await page.request.delete(`${BASE_URL}/api/preferences/${alice.id}/${liveBockTarget}`);
    } else {
      await page.request.put(`${BASE_URL}/api/preferences`, {
        data: { playerId: alice.id, gameId: liveBockTarget, rating: previousRating },
      });
    }
    await page.waitForTimeout(250);
    initiallySelected = await page.locator('[data-vote-game-checkbox]:checked').evaluateAll((els) =>
      els.map((el) => (el as HTMLInputElement).value),
    );
  }

  const voteGameCheckboxes = page.locator('[data-vote-game-checkbox]');
  const voteGameCount = await voteGameCheckboxes.count();
  assert.ok(voteGameCount >= 2, 'test fixture must ship at least two games');
  await page.click('[data-selection-search-trigger][aria-controls="votes-game-search"]');
  await page.fill('#votes-game-search', 'Counter-Strike 2');
  await page.waitForFunction(() => document.querySelectorAll('[data-vote-game-search-item]:not([hidden])').length === 1);
  await page.click('#votes-select-none');
  assert.equal(await page.locator('[data-vote-game-search-item]:not([hidden]) [data-vote-game-checkbox]:checked').count(), 0);
  assert.equal(
    await page.locator('[data-vote-game-search-item][hidden] [data-vote-game-checkbox]:checked').count(),
    initiallySelected.filter((gameId) => gameId !== counterStrike.id).length,
    'filtering must preserve checked games outside the visible result',
  );
  await page.fill('#votes-game-search', 'Kein Treffer XYZ');
  await page.waitForSelector('[data-vote-game-search-empty]:not([hidden])');
  await page.fill('#votes-game-search', '');
  await page.click('[data-selection-search]:has(#votes-game-search) [data-selection-search-close]');
  await page.click('#votes-select-all');
  await voteGameCheckboxes.nth(0).uncheck();
  await voteGameCheckboxes.nth(1).uncheck();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:rerender')));

  await page.waitForSelector('#votes-game-select-wrap:not([hidden])');
  assert.equal(await voteGameCheckboxes.nth(0).isChecked(), false, 'a manual deselection must survive an unrelated re-render');
  assert.equal(await voteGameCheckboxes.nth(1).isChecked(), false);

  // The previous single toggle button computed its action from whether
  // *all* boxes were checked, so clicking it in this exact mixed state
  // (2 unchecked, rest checked) re-checked everything instead of clearing
  // the rest. The two dedicated buttons must not depend on prior state.
  await page.click('#votes-select-none');
  assert.deepEqual(
    await voteGameCheckboxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked)),
    Array(voteGameCount).fill(false)
  );
  await page.click('#votes-select-all');
  assert.deepEqual(
    await voteGameCheckboxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked)),
    Array(voteGameCount).fill(true)
  );
});

flowTest('matchmaking Historie marks a recorded draw as Unentschieden', async () => {
  await openTeams();
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
  await page.click('[data-record-draw]');

  // "Unentschieden" is the default winner radio in the result form — submit
  // as-is to record a drawn result.
  await page.waitForSelector('#match-form');
  await page.click('#match-form button[type="submit"]');

  await page.waitForFunction(() => !!document.querySelector('[data-edit-draw-result]'));
  await openMatchmakingHistory();
  await page.waitForSelector('[data-draw-card] .badge:has-text("Unentschieden")');
});

flowTest('matchmaking Historie shows the winner after switching to Frei-für-alle for a drawn lineup', async () => {
  // Regression test: teams were drawn, but the result was entered as
  // "Frei-für-alle" instead of the drawn team shape — the draw must still
  // remain in Historie with the winner shown instead of retaining the open
  // draw actions.
  await openTeams();
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
  await page.click('[data-record-draw]');

  await page.waitForSelector('#match-form');
  await page.check('#match-ffa');
  await page.waitForSelector('input[name="ffa-winner"]');
  // First radio is a real participant (the "Kein Sieger" fallback is last).
  await page.check('input[name="ffa-winner"] >> nth=0');
  await page.click('#match-form button[type="submit"]');

  await page.waitForFunction(() => !!document.querySelector('[data-edit-draw-result]'));
  await openMatchmakingHistory();
  await page.waitForSelector('[data-draw-card] .matchmaking-draw-team.is-winner');
});

flowTest('Ergebnis eintragen keeps a manual team reassignment after changing "Anzahl Teams"', async () => {
  // Regression test: reassigning a player to a different team in the entry
  // form, then changing "Anzahl Teams", must not silently revert that player
  // back to the original drawn team.
  await openTeams();
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
  await page.click('[data-record-draw]');
  await page.waitForSelector('#match-players');

  await page.click('#match-game-search');
  await page.waitForSelector('#match-game-list:not([hidden])');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#match-game-list', { state: 'hidden' });
  assert.equal(
    await page.locator('#match-form').isVisible(),
    true,
    'Escape should close the game listbox without propagating to the result modal',
  );

  const teamSelects = page.locator('[data-team-for]');
  const firstPlayerId = await teamSelects.nth(0).getAttribute('data-team-for');
  const originalValue = await teamSelects.nth(0).inputValue();
  const otherValue = originalValue === '0' ? '1' : '0';
  await teamSelects.nth(0).selectOption(otherValue);

  // Bumping team count re-renders the player list — the manual reassignment
  // just made must survive that re-render.
  await page.fill('#match-teamcount', '3');
  await page.waitForSelector('[data-team-for]');
  const reselected = page.locator(`[data-team-for="${firstPlayerId}"]`);
  assert.equal(await reselected.inputValue(), otherValue);
});

flowTest('Auswertungen (via Mehr) shows a real award and keeps detail logs collapsed', async () => {
  // Create a player + a session via the real agent-report endpoint (not the
  // UI) so there's an actual play_sessions row to render.
  const account = await createE2EAccount(BASE_URL, adminCookie, 'Analytics E2E Player');
  const playerRes = await page.request.get(`${BASE_URL}/api/players/${account.id}`);
  assert.equal(playerRes.status(), 200);
  const player = await playerRes.json() as { api_key: string };
  const activeEventResponse = await fetch(`${BASE_URL}/api/events/active`, {
    headers: { cookie: account.cookie },
  });
  assert.equal(activeEventResponse.status, 200);
  const activeEvent = await activeEventResponse.json() as { id: string };
  const trackingResponse = await page.request.post(`${BASE_URL}/api/events/${activeEvent.id}/tracking/start`);
  assert.equal(trackingResponse.status(), 200, await trackingResponse.text());
  const consentResponse = await fetch(`${BASE_URL}/api/events/${activeEvent.id}/tracking-consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({ granted: true }),
  });
  assert.equal(consentResponse.status, 200, await consentResponse.text());
  await page.request.post(`${BASE_URL}/api/agent/report`, {
    headers: { 'x-api-key': player.api_key },
    data: { processNames: ['cs2.exe'] },
  });
  await new Promise((r) => setTimeout(r, 50));
  await page.request.post(`${BASE_URL}/api/agent/report`, {
    headers: { 'x-api-key': player.api_key },
    data: { processNames: [] }, // close the session so it has a real duration
  });

  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  // Spielzeit-Statistiken are the second tab of the "Auswertung" area.
  await openAuswertungTab('analytics');
  await page.waitForSelector('text=Marathon-Zocker', { timeout: 5000 });
  assert.ok((await page.textContent('.view-title'))?.includes('Auswertung'));

  // The noisy concurrency controls are intentionally gone. The session log
  // remains available on demand, but starts collapsed.
  assert.equal(await page.locator('#an-concurrency-game').count(), 0);
  const sessionLog = page.locator('details:has(summary:has-text("Session-Protokoll"))');
  assert.equal(await sessionLog.getAttribute('open'), null);
  await page.waitForSelector('text=Längste individuelle Session pro Spiel');
  assert.equal(await page.locator('#analytics-event-range-help').count(), 0);
  assert.equal(await page.getByText('Event wählen zeigt genau dessen Daten.', { exact: true }).count(), 0);
  assert.equal(await page.locator('#an-event-search[aria-label="Veranstaltung"]').count(), 1);
  assert.equal(await page.locator('[data-dt-field^="an-"]').count(), 0);

  // The "Matches & Turniere" tab (merged in from the old separate Spiele &
  // Turniere view) shares this same event filter and renders alongside it.
  await page.click('[data-an-tab="matches"]');
  await page.waitForSelector('text=Ergebnisse pro Spiel');
  assert.equal(await page.locator('#analytics-event-help').count(), 0);
  assert.equal(await page.locator('.analytics-tournament-breakdown').count(), 2);
  await page.waitForSelector('#analytics-fun-title:text-is("Trivia")');
  const triviaSection = page.locator('section[aria-labelledby="analytics-fun-title"]');
  // Earlier tests in this suite already recorded 1v1 results, so the biggest
  // rivalry card exists and the empty state must be gone.
  assert.equal(await triviaSection.getByText('Noch nicht genug Ergebnisse.', { exact: true }).count(), 0);
  assert.ok((await triviaSection.locator('.card').count()) >= 1, 'trivia should show at least one fun record');
  assert.equal(await triviaSection.locator('.empty-state-icon').count(), 0);
  assert.equal(await page.locator('#an-event-search[aria-label="Veranstaltung"]').count(), 1);

  await page.click('[data-an-tab="arcade"]');
  await page.waitForSelector('#analytics-arcade-total-title');
  assert.equal(await page.locator('#an-event-search[aria-label="Veranstaltung"]').count(), 1);
  assert.equal(await page.locator('[data-dt-field^="an-"]').count(), 0);
  assert.equal(await page.locator('#analytics-arcade-range-help').count(), 0);
  assert.equal(await page.getByText('Matches pro Tag', { exact: true }).count(), 0);
});
