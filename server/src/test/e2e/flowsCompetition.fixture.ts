// Browser E2E test, competition shard: players, matchmaking, voting and evaluations.
// One owner process drives the real built server + real Chromium; the shared
// server session, browser context and page live in ./flowsShared.fixture.
// Sibling tests here intentionally share that state and run in order.

import assert from 'node:assert/strict';
import type { Locator } from 'playwright';
import { addSessionCookie, createE2EAccount, waitForPlayerData } from './authHelpers';
import {
  flowTest,
  registerFlowFixture,
  BASE_URL,
  page,
  browser,
  adminCookie,
  alice,
  bob,
  openMatchmakingHistory,
  openTeams,
  openAuswertungTab,
  ensureAdminMode,
} from './flowsShared.fixture';
import { openMoreViewEntry } from './navHelpers';
import { TRACKING_CONSENT_TEXT_VERSION } from '../../privacyPolicy';
import { assertPaintedPollResultCentered } from './pollResultGeometry';

registerFlowFixture('competition');

async function assertRankedVoteColumns(card: Locator): Promise<void> {
  const chipHeights = await card.locator('.vote-win-chip').evaluateAll((chips) =>
    chips.map((chip) => chip.getBoundingClientRect().height));
  assert.ok(chipHeights.length > 1 && chipHeights.every((height) => Math.abs(height - chipHeights[0]) <= 1),
    'header and result Win labels share the same compact height');
  const layout = await card.locator('.event-poll-options').evaluate((options) => ({
    columns: getComputedStyle(options).gridTemplateColumns.split(' ').length,
    rows: Array.from(options.querySelectorAll('.event-poll-option')).map((row) => {
      const box = row.getBoundingClientRect();
      const title = row.querySelector('.event-poll-option-title-row')!;
      return { x: box.x, y: box.y, barX: row.querySelector('.event-poll-bar')!.getBoundingClientRect().x,
        titleExtraHeight: title.getBoundingClientRect().height - title.querySelector('strong')!.getBoundingClientRect().height,
        rank: Number(row.querySelector('.lb-rank')!.textContent),
        spokenRank: row.querySelector('.visually-hidden')!.textContent,
        score: Number(row.querySelector('.event-poll-count-text')!.textContent!.split(' ')[0]) };
    }),
  }));
  assert.equal(layout.columns, 2, 'wide latest and historical Vote results use two columns');
  assert.ok(layout.rows.every((row) => row.titleExtraHeight <= 1), 'Win labels do not increase the title-to-info spacing');
  const half = Math.ceil(layout.rows.length / 2);
  assert.deepEqual(layout.rows.map((row) => row.rank), layout.rows.map((row) =>
    layout.rows.findIndex((other) => other.score === row.score) + 1),
    'equal scores share a place across both columns, with subsequent places skipped');
  assert.deepEqual(layout.rows.map((row) => row.spokenRank), layout.rows.map((row) => `Platz ${row.rank}`),
    'screen readers receive an explicit place label as text');
  assert.equal(await card.locator('.lb-rank[aria-label]').count(), 0, 'generic spans have no prohibited accessible name');
  assert.deepEqual(layout.rows.map((row) => row.score), layout.rows.map((row) => row.score).sort((a, b) => b - a),
    'results follow the placement, highest score first');
  for (const column of [layout.rows.slice(0, half), layout.rows.slice(half)]) {
    assert.ok(column.every((row) => Math.abs(row.x - column[0].x) <= 1), 'each column contains consecutive placements');
    assert.ok(column.every((row) => Math.abs(row.barX - column[0].barX) <= 1),
      'result bars align even when an option has no supporters or points');
    assert.ok(column.every((row, index) => index === 0 || row.y > column[index - 1].y), 'placements read down each column');
  }
  if (layout.rows.length > 1) {
    assert.ok(layout.rows[half].x > layout.rows[0].x, 'the remaining placements continue in the right column');
    assert.ok(Math.abs(layout.rows[half].y - layout.rows[0].y) <= 1, 'both columns start on the same line');
  }
}

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
  const profileTitle = 'Tom & Jerry';
  const renameBob = await fetch(`${BASE_URL}/api/players/${bob.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: bob.cookie },
    body: JSON.stringify({ name: profileTitle }),
  });
  assert.equal(renameBob.status, 200, await renameBob.text());

  // The separate "Spieler" area is gone: Home's Live-Status is the roster and
  // every card opens that participant's profile. Identities are still created
  // through the API that future user management will own.
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector(`button[data-player]:has-text("${profileTitle}")`);

  // The live state (badge text) is part of the button's accessible name, not
  // hidden inside presentational children — role=button treats descendants as
  // presentational, so an aria-label alone would have silently dropped it.
  const bobCard = page.locator('button[data-player]', { hasText: profileTitle });
  const bobBadgeText = (await bobCard.locator('.badge').innerText()).trim();
  assert.ok(
    (await bobCard.getAttribute('aria-label'))?.includes(bobBadgeText),
    'the live-status badge text must be part of the card\'s accessible name',
  );

  // Other profiles are read-only; the current identity opens its own editor.
  await bobCard.click();
  const playerDialog = page.locator('.modal');
  await playerDialog.waitFor();
  assert.equal(await playerDialog.locator('.modal-header h2').count(), 1);
  assert.equal(await playerDialog.locator('.modal-header h2').textContent(), profileTitle);
  assert.equal(await playerDialog.getAttribute('aria-label'), profileTitle);
  assert.equal(await page.getByText(`Dieses Profil kann nur von ${profileTitle} selbst bearbeitet werden.`, { exact: true }).count(), 0);
  assert.equal(await page.locator('#detail-save, #detail-delete, #detail-apikey').count(), 0);
  await page.click('[data-close]');
  await page.click('button[data-player] >> text=E2E Alice');
  await page.waitForSelector('#profile-name');
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');

  // Matchmaking: draw teams for both players.
  await openTeams();
  assert.equal(await page.inputValue('#mm-teamcount'), '2');
  // The team count is capped at the selected players: typing more snaps back.
  assert.equal(await page.getAttribute('#mm-teamcount', 'max'), '2');
  await page.fill('#mm-teamcount', '5');
  assert.equal(await page.inputValue('#mm-teamcount'), '2');
  // A realtime re-render while the field is focused restores the value typed
  // before it, without an input event. When the roster has shrunk below that
  // value in the meantime, the restored value must be capped again. Plant such
  // a stale value the same way (no input event) and trigger players:changed.
  await page.focus('#mm-teamcount');
  await page.locator('#mm-teamcount').evaluate((input: HTMLInputElement) => {
    input.value = '5';
    input.dataset.beforeRealtimeRender = 'true';
  });
  const touchBob = await fetch(`${BASE_URL}/api/players/${bob.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: bob.cookie },
    body: JSON.stringify({ name: profileTitle }),
  });
  assert.equal(touchBob.status, 200, await touchBob.text());
  await page.waitForFunction(() => {
    const input = document.querySelector<HTMLInputElement>('#mm-teamcount');
    return Boolean(input) && input!.dataset.beforeRealtimeRender === undefined;
  });
  assert.equal(await page.inputValue('#mm-teamcount'), '2');
  // The roster search is an always-visible named field, not a magnifier toggle.
  assert.equal(await page.getAttribute('#mm-player-search', 'placeholder'), 'Spieler suchen');
  await page.fill('#mm-player-search', profileTitle);
  await page.waitForFunction(() => document.querySelectorAll('[data-mm-draw-search-item]:not([hidden])').length === 1);
  assert.equal(await page.locator('[data-mm-draw-search-item]:not([hidden])').getByText(profileTitle, { exact: true }).count(), 1);
  // One bulk toggle: with every visible player selected it offers deselect.
  assert.equal(await page.getAttribute('#mm-select-all', 'aria-label'), 'Sichtbare Spieler abwählen');
  await page.click('#mm-select-all');
  assert.equal(await page.getAttribute('#mm-select-all', 'aria-label'), 'Sichtbare Spieler markieren');
  assert.equal(await page.locator('[data-mm-draw-search-item]:not([hidden]) [data-player]:checked').count(), 0);
  assert.equal(
    await page.locator('[data-mm-draw-search-item][hidden] [data-player]:checked').count(),
    1,
    'filtering must not clear a hidden player selection',
  );
  await page.fill('#mm-player-search', 'Kein passender Spieler XYZ');
  await page.waitForSelector('[data-roster-picker="mm-draw-roster"] [data-roster-picker-empty]:not([hidden])');
  await page.fill('#mm-player-search', '');
  await page.waitForFunction(() => document.querySelectorAll('[data-mm-draw-search-item][hidden]').length === 0);
  await page.click('#mm-select-all');
  assert.equal(await page.locator('[data-player]:checked').count(), 2);
  await page.click('#mm-select-all');
  assert.equal(await page.locator('[data-player]:checked').count(), 0);
  await page.click('#mm-select-all');
  assert.equal(await page.locator('[data-player]:checked').count(), 2);
  assert.equal(await page.locator('details.history-details:has(summary:has-text("Historie"))').getAttribute('open'), null);

  // Player cards (checkbox, avatar, name, skill value) stack in a single
  // column on phones; two columns would leave no readable room for names.
  const drawPlayerGrid = page.locator('section[aria-labelledby="matchmaking-draw-title"] .player-selection-grid');
  const toolbarSpacing = await drawPlayerGrid.evaluate((grid) => {
    const toolbar = grid.previousElementSibling;
    if (!toolbar?.classList.contains('selection-toolbar')) return null;
    return {
      actual: Math.round(grid.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom),
      expected: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-3')),
    };
  });
  assert.ok(toolbarSpacing, 'RosterPicker renders its selection toolbar before the grid');
  assert.equal(toolbarSpacing.actual, toolbarSpacing.expected, 'RosterPicker keeps var(--space-3) between toolbar and grid');
  const longNameGeometry = await drawPlayerGrid.locator('.check-row').first().evaluate((row) => {
    const name = row.querySelector('.player-name')!;
    const originalName = name.textContent;
    try {
      name.textContent = 'AußergewöhnlichLangerUngekürzterSpielernameFürDenRosterPicker';
      const range = document.createRange();
      range.selectNodeContents(name);
      return {
        lines: range.getClientRects().length,
        rowOverflow: row.scrollWidth > row.clientWidth,
        viewOverflow: document.querySelector('#view-container')!.scrollWidth > document.querySelector('#view-container')!.clientWidth,
      };
    } finally {
      name.textContent = originalName;
    }
  });
  assert.ok(longNameGeometry.lines > 1, 'a long roster name wraps inside its card');
  assert.equal(longNameGeometry.rowOverflow, false);
  assert.equal(longNameGeometry.viewOverflow, false);
  const mobileSelectionColumns = await drawPlayerGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  );
  assert.equal(mobileSelectionColumns, 1);
  await page.setViewportSize({ width: 320, height: 568 });
  assert.equal(await drawPlayerGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
  assert.equal(await page.locator('#view-container').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await drawPlayerGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
  await page.setViewportSize({ width: 512, height: 384 });
  assert.equal(await drawPlayerGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
  assert.equal(await page.locator('#view-container').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  await page.setViewportSize({ width: 720, height: 450 });
  assert.equal(await drawPlayerGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);
  assert.equal(await page.locator('#view-container').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  const modeAtLaptop = await page.locator('.matchmaking-setup-head .selection-toolbar').boundingBox();
  const gameAtLaptop = await page.locator('#mm-game-search').boundingBox();
  assert.ok(modeAtLaptop && gameAtLaptop && modeAtLaptop.x + modeAtLaptop.width < gameAtLaptop.x,
    'mode selection sits left of the game selection on laptop');
  await page.setViewportSize({ width: 900, height: 844 });
  const desktopSelectionColumns = await drawPlayerGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  );
  assert.equal(desktopSelectionColumns, 2);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.waitForFunction(() => document.documentElement.dataset.layoutMode === 'desktop');
  assert.equal(
    await drawPlayerGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    3,
    'only Matchmaking gains a third roster column in desktop layout mode',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.dataset.layoutMode === 'laptop');

  // Only the selected mode's section renders — switch to Captain Draft to
  // reach its tooltip, then back to Auslosung to reach "Teams auslosen".
  // Switching keeps the search field and the roster at the same height.
  const rosterEdges = () =>
    page.evaluate(() => {
      const top = (selector: string) => Math.round(document.querySelector(selector)!.getBoundingClientRect().top);
      return { search: top('.match-mode-panel .selection-search'), grid: top('.match-mode-panel .player-selection-grid') };
    });
  const drawRosterEdges = await rosterEdges();
  await page.click('[data-mm-mode="draft"]');
  assert.equal(await page.locator('#draft-player-search').count(), 1);
  assert.deepEqual(await rosterEdges(), drawRosterEdges);
  // The draft roster search is the only search field and narrows the captain list too.
  assert.equal(await page.locator('[data-roster-picker="mm-captain-roster"] input[type="search"]').count(), 0);
  await page.fill('#draft-player-search', 'E2E Alice');
  await page.waitForFunction(() => document.querySelectorAll('[data-mm-captain-search-item]:not([hidden])').length === 1);
  assert.equal(await page.locator('[data-mm-captain-search-item]:not([hidden])').getByText('E2E Alice', { exact: true }).count(), 1);
  await page.fill('#draft-player-search', '');
  await page.waitForFunction(() => document.querySelectorAll('[data-mm-captain-search-item][hidden]').length === 0);
  const draftHelp = page.locator('[aria-controls="captain-draft-help"]');
  await draftHelp.waitFor();
  await draftHelp.click();
  assert.equal(await draftHelp.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await draftHelp.getAttribute('aria-expanded'), 'false');

  await page.click('[data-mm-mode="draw"]');
  await page.waitForSelector('#mm-generate');
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    const drawActions = await page.locator('.match-mode-panel .card-footer-actions').evaluate((footer) => {
      const button = footer.querySelector('#mm-generate')!.getBoundingClientRect();
      const option = footer.querySelector('#mm-avoid-adjacent')!.getBoundingClientRect();
      return { offset: Math.abs(button.top + button.height / 2 - option.top - option.height / 2),
        precedesButton: option.right < button.left };
    });
    assert.ok(drawActions.offset <= 1 && drawActions.precedesButton, JSON.stringify(drawActions));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#mm-generate');
  await page.waitForSelector('.matchmaking-new-draw .team-card');
  const teamCards = await page.locator('.matchmaking-new-draw .team-card').count();
  assert.ok(teamCards >= 2, 'expected at least 2 team cards');
  assert.equal(await page.locator('.matchmaking-new-draw .matchmaking-draw-head .player-name strong').count(), 1);
  assert.equal(await page.locator('.matchmaking-new-draw .team-player-name strong').innerText(), alice.name);
  await page.setViewportSize({ width: 1280, height: 844 });
  assert.equal(await page.locator('.matchmaking-new-draw .tournament-team-preview-grid').evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length), 4);
  await page.setViewportSize({ width: 390, height: 844 });

  // Neither of these two players rated the game, so both enter the draw with
  // the server's neutral fallback. That has to stay visible: each row shows
  // the parenthesized fallback, and every team header's total is the sum of
  // its own visible rows plus the count of unrated players.
  assert.ok((await page.locator('.matchmaking-new-draw .team-card .team-player .rating-unrated').count()) > 0);
  const drawnTeams = await page.locator('.matchmaking-new-draw .team-card').evaluateAll((cards) =>
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
  // fresh), rate every game, save, change the ballot and save again. Alice's
  // personal session already fixes the voter identity, so no extra identity
  // form appears. Picking a number only stages a local draft — it must not
  // count as a vote until "Speichern" is pressed. While the round is open, no
  // per-game distribution (bars/counts) may be visible anywhere — only total
  // participation and the voter's own ballot.
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-start');
  assert.equal(await page.locator('.card-footer-actions #votes-start').count(), 1);
  // History loading can replace the card between resolving a Locator and
  // evaluating it. Read both current elements in one DOM snapshot.
  const startBelowGames = await page.evaluate(() =>
    document.querySelector('#votes-start')!.getBoundingClientRect().top
      > document.querySelector('#votes-game-select-wrap')!.getBoundingClientRect().bottom);
  assert.ok(startBelowGames, 'starting the round follows the entire game selection');
  assert.equal(await page.getByText('Du bist E2E Alice', { exact: true }).count(), 0);
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close'); // only rendered once the round shows as open
  const roundCard = page.locator('.vote-round-card');
  await roundCard.locator('[data-vote-participation]:text-is("0/2 abgegeben")').waitFor();
  // Opening the round also kicks off votes.js's own follow-up mine/history
  // fetches, each of which rerenders the card once it resolves.
  await page.waitForLoadState('networkidle');
  await roundCard.locator('.event-poll-answer-inline:has-text("Deine Stimme fehlt")').waitFor();
  // Same card shape as an Umfrage: Beenden and Abbrechen side by side in the
  // header (no one-item "Aktion" menu), one row per game and the save action
  // in the footer.
  assert.equal(await roundCard.locator('.event-poll-card-side > #votes-close').count(), 1);
  assert.equal(await roundCard.locator('.event-poll-card-side > #votes-cancel').count(), 1);
  assert.equal(await roundCard.locator('.action-menu').count(), 0);
  assert.equal(await roundCard.locator('.event-poll-footer #votes-submit').count(), 1);
  assert.ok(await page.locator('#votes-submit').isDisabled(), 'an incomplete ballot cannot be saved');
  assert.equal(await roundCard.locator('.event-poll-tag:text-is("Zwischenstand verborgen")').count(), 1);
  assert.equal(await roundCard.locator('.event-poll-bar').count(), 0, 'no bars while the round is open');
  // With the result hidden, the numbers sit beside the name: two columns
  // from --bp-lg that read down the left column first, the regular stacked
  // rows on a phone. Every row names the viewer's own Skill as orientation.
  const ballotColumns = () => roundCard.locator('.event-poll-options').evaluate((element) =>
    getComputedStyle(element).display === 'grid' ? getComputedStyle(element).gridTemplateColumns.split(' ').length : 1);
  assert.equal(await ballotColumns(), 1);
  await page.setViewportSize({ width: 900, height: 844 });
  assert.equal(await ballotColumns(), 2);
  const ballotAlignment = await roundCard.locator('[data-points-row]').evaluateAll((rows) => rows.map((row, index) => {
    const box = row.getBoundingClientRect();
    const next = rows.slice(index + 1).find((candidate) => candidate.getBoundingClientRect().left === box.left);
    const middle = (box.top + (next?.getBoundingClientRect().top ?? box.bottom)) / 2;
    return ['.event-poll-option-info', '.rating-scale'].map((selector) => {
      const rect = row.querySelector(selector)!.getBoundingClientRect();
      return Math.abs(rect.top + rect.height / 2 - middle);
    });
  }));
  assert.ok(ballotAlignment.flat().every((offset) => offset <= 1), 'ballot text and controls center between the separating lines');
  const ballotLefts = await roundCard.locator('[data-points-row]').evaluateAll((rows) =>
    rows.map((row) => Math.round(row.getBoundingClientRect().left)));
  const leftColumnCount = Math.ceil(ballotLefts.length / 2);
  assert.deepEqual(
    ballotLefts.map((left) => left === ballotLefts[0]),
    ballotLefts.map((_, index) => index < leftColumnCount),
    'the first half of the alphabetical list fills the left column, the rest the right one'
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.match((await roundCard.locator('.vote-own-skill').first().textContent()) ?? '', /^Mein Skill: (\d|–)$/);

  // Same 0-5 number scale as an Umfrage rating.
  const ballotRows = roundCard.locator('[data-points-row]');
  const setPoints = async (index: number, value: number) => {
    const button = ballotRows.nth(index).locator(`[data-points-value="${value}"]`);
    await button.click();
    await ballotRows.nth(index).locator(`[data-points-value="${value}"][aria-pressed="true"]`).waitFor();
    assert.equal(await ballotRows.nth(index).locator('.rating-scale-meter-fill').evaluate((fill) =>
      (fill as HTMLElement).style.width), `${value * 20}%`, 'the own draft updates the meter before saving');
  };
  const totalGames = await ballotRows.count();
  assert.deepEqual(await ballotRows.first().locator('[data-vote-points]').allTextContents(), ['0', '1', '2', '3', '4', '5']);

  // Regression: a cancelled round is deleted and the next round reuses its
  // number. Its saved ballot must neither prefill nor mark the new round as
  // answered; an unanswered ballot starts from the own Bock instead, here
  // for the one game Alice has a Bock for.
  for (let index = 0; index < totalGames; index += 1) await setPoints(index, 2);
  await page.click('#votes-submit');
  await roundCard.locator('.event-poll-answer-inline:has-text("Abgegeben")').waitFor();
  const bockGameId = (await ballotRows.first().getAttribute('data-points-row')) ?? '';
  const bockResponse = await page.request.put(`${BASE_URL}/api/preferences`, {
    data: { playerId: alice.id, gameId: bockGameId, rating: 4 },
  });
  assert.equal(bockResponse.status(), 200, await bockResponse.text());
  await page.click('#votes-cancel');
  await page.click('[data-confirm]');
  await page.waitForSelector('#votes-start');
  await page.click('#votes-start');
  await roundCard.locator('[data-vote-participation]:text-is("0/2 abgegeben")').waitFor();
  await roundCard.locator('.event-poll-answer-inline:has-text("Deine Stimme fehlt")').waitFor();
  await page.waitForLoadState('networkidle');
  assert.deepEqual(
    await roundCard.locator('[data-vote-points][aria-pressed="true"]').evaluateAll((buttons) =>
      buttons.map((button) => [(button as HTMLElement).dataset.votePoints, (button as HTMLElement).dataset.pointsValue])),
    [[bockGameId, '4']],
    'only the own Bock is preselected, never the cancelled ballot'
  );
  await roundCard.locator('[data-vote-rated-progress]').filter({ hasText: `1 von ${totalGames} bewertet` }).waitFor();
  assert.ok(await page.locator('#votes-submit').isDisabled());
  const bockCleanup = await page.request.delete(`${BASE_URL}/api/preferences/${alice.id}/${bockGameId}`);
  assert.equal(bockCleanup.status(), 204);
  await setPoints(0, 5);
  await setPoints(1, 5);
  await roundCard.locator('[data-vote-rated-progress]').filter({ hasText: `2 von ${totalGames} bewertet` }).waitFor();
  assert.equal(
    await roundCard.locator('[data-vote-participation]:text-is("0/2 abgegeben")').count(),
    1,
    'picking a number must not submit it by itself'
  );

  // Every other game gets a deliberate 0, marked "Spiele ich nicht".
  for (let index = 2; index < totalGames; index += 1) await setPoints(index, 0);
  assert.equal(await roundCard.locator('[data-decline-tag]:visible').count(), totalGames - 2);
  assert.ok(!(await page.locator('#votes-submit').isDisabled()), 'a complete ballot can be saved');

  await page.click('#votes-submit');
  await roundCard.locator('[data-vote-participation]:text-is("1/2 abgegeben")').waitFor();
  await roundCard.locator('.event-poll-answer-inline:has-text("Abgegeben")').waitFor();
  assert.ok(!(await ballotRows.first().locator('[data-vote-points]').first().isDisabled()), 'a saved ballot stays editable');
  assert.equal(await roundCard.locator('.event-poll-bar').count(), 0, 'still no bars after saving, before closing');

  // Changing the ballot replaces it instead of adding a second one.
  await setPoints(2, 1);
  const [changed] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/votes/points') && response.request().method() === 'POST'),
    page.click('#votes-submit'),
  ]);
  assert.equal(changed.status(), 200);
  const mine = await (await page.request.get(`${BASE_URL}/api/votes/mine?playerId=${alice.id}`)).json();
  assert.equal(mine.entries.length, totalGames, 'the change replaced the ballot instead of adding one');
  assert.equal(mine.entries.filter((entry: { points: number }) => entry.points === 1).length, 1);
  await roundCard.locator('[data-vote-participation]:text-is("1/2 abgegeben")').waitFor();

  const ballotGradient = await ballotRows.first().locator('.rating-scale-meter-fill').evaluate((fill) =>
    getComputedStyle(fill).backgroundImage);
  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
  // Closing reveals the result as a collapsed Umfrage card: the header names
  // the winners and keeps its actions; opening it shows every game of the
  // round with its bar, how many voters would play it and the "Win" chips.
  const currentVote = page.locator('section[aria-labelledby="vote-current-result-title"]');
  const latestToggle = currentVote.locator('[data-toggle-latest-vote]');
  await latestToggle.waitFor();
  assert.equal(await latestToggle.getAttribute('aria-expanded'), 'false', 'the latest result starts collapsed');
  assert.equal(await currentVote.locator('.event-poll-card-header .vote-win-chip').count(), 1);
  assert.equal(await currentVote.locator('.event-poll-option:visible').count(), 0);
  // A desktop header has room for its result and actions on one line.
  // On a phone those contents deliberately wrap instead of being clipped.
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.waitForFunction(() => document.documentElement.dataset.layoutMode === 'desktop');
  const rankingDisclosure = page.locator('details.collapsible-section').filter({ hasText: 'Top 10 nach Bock-Level' });
  const latestGeometry = await currentVote.evaluate((card) => ({
    height: card.getBoundingClientRect().height,
    titleX: card.querySelector('strong')!.getBoundingClientRect().x,
  }));
  const rankingGeometry = await rankingDisclosure.evaluate((card) => ({
    height: card.getBoundingClientRect().height,
    titleX: card.querySelector('h2')!.getBoundingClientRect().x,
  }));
  assert.equal(latestGeometry.height, rankingGeometry.height, 'closed Vote sections share one height');
  assert.equal(latestGeometry.titleX, rankingGeometry.titleX, 'closed Vote section titles align');
  await rankingDisclosure.locator(':scope > summary').click();
  const bockRanks = await rankingDisclosure.locator('.lb-row').evaluateAll((rows) => rows.map((row) => ({
    rank: Number(row.querySelector('.lb-rank')!.textContent),
    average: Number(row.querySelector('.lb-points')!.textContent!.match(/\d+(?:\.\d+)?/)?.[0] ?? -1),
  })));
  assert.deepEqual(bockRanks.map((row) => row.rank), bockRanks.map((row) =>
    bockRanks.findIndex((other) => other.average === row.average) + 1), 'equal Bock values share Top-10 places');
  await rankingDisclosure.locator(':scope > summary').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await latestToggle.click();
  await page.waitForFunction(
    (expected) => document.querySelectorAll('section[aria-labelledby="vote-current-result-title"] .event-poll-option').length === expected,
    totalGames
  );
  assert.equal(await currentVote.locator('.event-poll-option.is-winner .vote-win-chip').count(), 2);
  assert.deepEqual(await currentVote.locator('.event-poll-option.is-winner .lb-rank').allTextContents(), ['1', '1']);
  assert.equal(await currentVote.locator('.event-poll-option.is-winner .lb-rank.is-first').count(), 2,
    'both tied winners receive the first-place emphasis');
  assert.equal(await currentVote.locator('.event-poll-bar-fill.is-choice').first().evaluate((fill) =>
    getComputedStyle(fill).backgroundImage), ballotGradient, 'ballot and result bars use the same gradient');
  await page.setViewportSize({ width: 1280, height: 844 });
  assert.equal(await currentVote.evaluate((card) => {
    const header = card.querySelector('.event-poll-card-toggle')!.getBoundingClientRect();
    const options = card.querySelector('.event-poll-options')!.getBoundingClientRect();
    return options.top - header.bottom;
  }), 12, 'expanded Vote has exactly one shared gap before its list');
  await assertRankedVoteColumns(currentVote);
  const resultAlignment = await currentVote.locator('.event-poll-option').evaluateAll((rows) => rows.map((row, index) => {
    const center = (selector: string) => {
      const rect = row.querySelector(selector)!.getBoundingClientRect();
      return rect.top + rect.height / 2;
    };
    const rect = row.getBoundingClientRect();
    const next = rows.slice(index + 1).find((candidate) => Math.abs(candidate.getBoundingClientRect().x - rect.x) <= 1);
    const middle = (rect.top + (next?.getBoundingClientRect().top ?? rect.bottom)) / 2;
    return ['.event-poll-option-info', '.event-poll-result', '.event-poll-option-badges']
      .map((selector) => Math.abs(center(selector) - middle));
  }));
  assert.ok(resultAlignment.flat().every((offset) => offset <= 1), 'complete result blocks center between the separating lines');
  await assertPaintedPollResultCentered(currentVote.locator('.event-poll-option.is-winner').first());
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await currentVote.locator('.event-poll-options').evaluate((options) =>
    getComputedStyle(options).display), 'flex', 'phone results remain one readable column');
  assert.deepEqual(
    await currentVote.locator('.event-poll-option.is-winner .event-poll-counts').allTextContents(),
    ['5 Pkt. · 1/1 spielen mit', '5 Pkt. · 1/1 spielen mit']
  );
  assert.ok((await currentVote.locator('.event-poll-counts').allTextContents()).includes('0 Pkt. · 0/1 spielen mit'));
  assert.equal(await currentVote.locator('.event-poll-option.is-winner .event-poll-voter-stack').count(), 2);
  assert.equal(await currentVote.getByText('Unentschieden', { exact: true }).count(), 0);
  assert.equal(await currentVote.locator('#votes-runoff').count(), 1, 'the runoff action belongs to the current Vote card');
  assert.equal(await currentVote.locator('#votes-generate-match').count(), 0, 'a tie has no single game to draw teams for');
  assert.equal(await page.locator('section[aria-labelledby="vote-runoff-title"]').count(), 0, 'no separate runoff card remains');
  assert.equal(await page.locator('details.history-details:has(summary:has-text("Historie"))').getAttribute('open'), null);

  // Historie lists only older rounds, so the just-closed round is not
  // repeated there; who voted how opens from "Letzter Vote" instead.
  await page.click('details.history-details:has(summary:has-text("Historie")) > summary');
  await page.waitForSelector('[data-vote-history] >> text=Noch keine älteren Abstimmungen.');
  assert.equal(await page.locator('[data-vote-history] [data-vote-history-round]').count(), 0);
  await currentVote.locator('.event-poll-card-side [data-open-vote-round]:text-is("Stimmen ansehen")').click();
  await page.waitForSelector('.modal h2:text-is("Stimmen · Abstimmung Runde 1")');
  const breakdown = page.locator('.modal .event-poll-vote-table');
  await breakdown.waitFor();
  assert.equal(await breakdown.locator('tbody tr').count(), 1);
  assert.equal(await breakdown.locator('tbody th:has-text("E2E Alice")').count(), 1);
  assert.equal(await breakdown.locator('tbody .event-poll-vote-cell.is-cannot[aria-label="Spielt nicht"]').count(), totalGames - 3);
  assert.equal(await page.locator('.modal .event-poll-vote-key:has-text("Spielt nicht")').count(), 1);
  await page.click('[data-close]');

  // Closing the runoff moves the previous result into its own history card.
  await currentVote.locator('#votes-runoff').click();
  // Alice gave both tied games 5 points, so neither was declined before.
  const runoffDeclines = page.locator('[data-points-row] .event-poll-option-note', { hasText: 'Vorrunde: 0 spielen nicht' });
  await runoffDeclines.first().waitFor();
  assert.equal(await runoffDeclines.count(), 2, 'every runoff game names its declines from the tied round');
  const runoffPick = page.locator('[data-vote-select]').first();
  const runoffGameId = (await runoffPick.getAttribute('data-vote-select')) ?? '';
  await runoffPick.click();
  await page.locator('#votes-submit').click();
  await page.locator('[data-vote-participation]:text-is("1/2 abgegeben")').waitFor();
  await page.locator('#votes-close').click();
  const historyCard = page.locator('[data-vote-history-round="1"]');
  const historyToggle = historyCard.locator('[data-toggle-vote-history]');
  await historyToggle.waitFor();
  assert.equal(await historyToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await historyCard.locator('.event-poll-option:visible').count(), 0);
  assert.match((await historyToggle.textContent()) ?? '', /Abstimmung Runde 1/);
  await historyToggle.focus();
  await page.keyboard.press('Enter');
  await historyCard.locator('.event-poll-option').first().waitFor();
  assert.equal(await historyCard.locator('.event-poll-option').count(), totalGames);
  assert.equal(await historyCard.locator('.event-poll-option.is-winner .vote-win-chip').count(), 2);
  await page.setViewportSize({ width: 1024, height: 844 });
  await assertRankedVoteColumns(historyCard);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await historyToggle.evaluate((button) => document.activeElement === button), true);
  await historyCard.locator('.event-poll-card-side [data-open-vote-round]').click();
  await page.locator('.modal h2:text-is("Stimmen · Abstimmung Runde 1")').waitFor();
  await page.click('[data-close]');
  await page.click('.nav-btn[data-view="home"]');
  await page.click('.nav-btn[data-view="votes"]');
  await historyToggle.waitFor();
  assert.equal(await historyToggle.getAttribute('aria-expanded'), 'true', 'history expansion survives a re-render');
  await historyToggle.click();
  await historyCard.locator('.event-poll-option').first().waitFor({ state: 'detached' });
  assert.equal(await historyToggle.getAttribute('aria-expanded'), 'false');

  // The decided runoff hands its winner and its participants who did not
  // decline that game before to Match, so only the team count is left.
  await currentVote.locator('#votes-generate-match').click();
  await page.waitForSelector('#mm-generate');
  assert.equal(await page.inputValue('#mm-game'), runoffGameId);
  assert.ok(await page.locator(`[data-player="${alice.id}"]`).isChecked(), 'the voter is preselected');
  assert.ok(!(await page.locator(`[data-player="${bob.id}"]`).isChecked()), 'a player who did not vote stays unselected');
  // Later tests draw with both players again.
  await page.click('#mm-select-all');
  await page.locator(`[data-player="${bob.id}"]:checked`).waitFor();

  // Admin mode stays active from here for the rest of this shard's shared
  // page/session (test players, Arcade AI). Auswertung itself no longer
  // depends on it - it lives behind Admin's own "Auswertung" tool card,
  // gated by the real admin role instead.
  await openMoreViewEntry(page, '[data-navigate="admin"]');
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
  await page.click('#match-form [data-result-mode="score"]');
  assert.equal(await page.locator('#match-form .result-score-row').count(), 2);
  assert.equal(
    await page.locator('#match-form').evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
    'score rows should remain inside the result group'
  );
  await page.locator('#admin-result-score-0 + .number-stepper-steps .number-stepper-btn[aria-label="Wert erhöhen"]').click();
  assert.equal(await page.inputValue('#admin-result-score-0'), '1', 'step="any" keeps the number-stepper fallback');
  assert.equal(await page.locator('[data-result-rank="0"]').innerText(), '1');
  const teamSelects = page.locator('[data-team-for]');
  const firstTeamPlayerId = await teamSelects.nth(0).getAttribute('data-team-for');
  await teamSelects.nth(0).focus();
  await teamSelects.nth(0).selectOption('0');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-team-for')), firstTeamPlayerId);
  assert.equal(await page.inputValue('#admin-result-score-0'), '1', 'assigning a player must keep the entered score');
  await teamSelects.nth(1).selectOption('1');
  assert.equal(await page.inputValue('#admin-result-score-0'), '1');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal[aria-label="Änderungen verwerfen?"]');
  await page.click('.modal[aria-label="Änderungen verwerfen?"] [data-cancel]');
  assert.equal(await page.inputValue('#admin-result-score-0'), '1', 'canceling close keeps the result');
  await page.click('#match-form [data-result-mode="winner"]');
  await page.locator('#match-form label.tournament-result-pick:has(input[value="0"])').click();
  await page.click('#match-form [data-result-save]');
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
  // Home's top six are a RankedList: two columns, left one filled first.
  assert.deepEqual(
    await page.locator('[aria-labelledby="home-leaderboard-title"] .ranked-list').evaluate((element) =>
      [getComputedStyle(element).gridTemplateColumns.split(' ').length, getComputedStyle(element).gridAutoFlow]),
    [2, 'column'],
    'home leaderboard should read top to bottom in two columns when the card has enough width'
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
  const alphabeticalVoteOrder = catalogGames
    .filter((game) => catalogGameIds.has(game.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map((game) => game.id);
  const renderedVoteOrder = await page.locator('[data-vote-game-checkbox]').evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).value),
  );
  assert.deepEqual(renderedVoteOrder, alphabeticalVoteOrder, 'the vote game list should be sorted alphabetically');
  let initiallySelected = await page.locator('[data-vote-game-checkbox]:checked').evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).value),
  );
  assert.deepEqual(
    [...initiallySelected].sort(),
    expectedVoteOrder.slice(0, 10).sort(),
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
      data: { playerId: alice.id, gameId: liveBockTarget, rating: 5 },
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
      [...liveSelected].sort(),
      liveExpectedVoteOrder.slice(0, 10).sort(),
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
  assert.equal(await page.getAttribute('#votes-game-search', 'placeholder'), 'Spiel suchen');
  await page.fill('#votes-game-search', 'Counter-Strike 2');
  await page.waitForFunction(() => document.querySelectorAll('[data-vote-game-search-item]:not([hidden])').length === 1);
  // One bulk toggle acts on the visible result only; flip it until the lone
  // visible game is deselected.
  await page.click('#votes-select-all');
  if (await page.locator('[data-vote-game-search-item]:not([hidden]) [data-vote-game-checkbox]:checked').count()) {
    await page.click('#votes-select-all');
  }
  assert.equal(await page.locator('[data-vote-game-search-item]:not([hidden]) [data-vote-game-checkbox]:checked').count(), 0);
  assert.equal(
    await page.locator('[data-vote-game-search-item][hidden] [data-vote-game-checkbox]:checked').count(),
    initiallySelected.filter((gameId) => gameId !== counterStrike.id).length,
    'filtering must preserve checked games outside the visible result',
  );
  await page.fill('#votes-game-search', 'Kein Treffer XYZ');
  await page.waitForSelector('[data-vote-game-search-empty]:not([hidden])');
  await page.fill('#votes-game-search', '');
  await page.waitForFunction(() => document.querySelectorAll('[data-vote-game-search-item][hidden]').length === 0);
  if ((await page.getAttribute('#votes-select-all', 'aria-label')) === 'Sichtbare Spiele markieren') {
    await page.click('#votes-select-all');
  }
  await voteGameCheckboxes.nth(0).uncheck();
  await voteGameCheckboxes.nth(1).uncheck();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:rerender')));

  await page.waitForSelector('#votes-game-select-wrap:not([hidden])');
  assert.equal(await voteGameCheckboxes.nth(0).isChecked(), false, 'a manual deselection must survive an unrelated re-render');
  assert.equal(await voteGameCheckboxes.nth(1).isChecked(), false);

  // The single bulk toggle derives its action from the visible state: in this
  // mixed state (2 unchecked) it selects all, then a second click clears all.
  assert.equal(await page.getAttribute('#votes-select-all', 'aria-label'), 'Sichtbare Spiele markieren');
  await page.click('#votes-select-all');
  assert.deepEqual(
    await voteGameCheckboxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked)),
    Array(voteGameCount).fill(true)
  );
  await page.click('#votes-select-all');
  assert.deepEqual(
    await voteGameCheckboxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked)),
    Array(voteGameCount).fill(false)
  );
});

flowTest('matchmaking Historie marks a recorded draw as Unentschieden', async () => {
  await openTeams();
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  const openTile = page.locator('.matchmaking-open-draws');
  assert.equal(await openTile.getAttribute('open'), null, 'unplayed games start collapsed');
  assert.equal(await openTile.evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector('.history-details')!) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  assert.equal(await page.locator('#match-history-open .matchmaking-history-item').count(), 0, 'closed open draws should not build every editable card');
  if ((await openTile.getAttribute('open')) === null) await openTile.locator('summary').click();
  const openDraw = page.locator('#match-history-open .matchmaking-history-item').first();
  await openDraw.waitFor();
  const drawToggle = openDraw.locator('[data-history-toggle]');
  const drawDetails = openDraw.locator('.matchmaking-history-details');
  assert.equal(await drawToggle.getAttribute('aria-expanded'), 'false', 'each unplayed game starts collapsed');
  assert.equal(await drawToggle.locator('.matchmaking-history-title strong').count(), 1,
    'the collapsed game identifies a participant');
  assert.equal(await drawDetails.isVisible(), false);
  await drawToggle.click();
  assert.equal(await drawToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await drawDetails.isVisible(), true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:rerender')));
  await page.waitForSelector('#match-history-open [data-history-toggle][aria-expanded="true"]');
  assert.equal(await drawDetails.isVisible(), true, 'an open game stays open after the page updates');
  await drawToggle.click();
  assert.equal(await drawDetails.isVisible(), false, 'an individual unplayed game can be collapsed again');
  await drawToggle.click();
  assert.ok(await page.locator('#match-history-open .team-player .rating').count() >= 2);
  assert.equal(await page.locator('#match-history-open .team-player-name strong').first().innerText(), alice.name);
  assert.ok(await page.locator('#match-history-open .team-skill-total').count() >= 2);
  await page.click('#match-history-open [data-record-draw]');

  const panelHeight = await page.locator('.modal .result-mode-panels').evaluate((element) => element.getBoundingClientRect().height);
  const pickHeights = await page.locator('.modal .tournament-result-pick').evaluateAll((picks) =>
    picks.map((pick) => Math.round(pick.getBoundingClientRect().height)));
  assert.ok(pickHeights.every((height) => height === pickHeights[0]), 'draw choice has the same height as team choices');
  await page.click('.modal [data-result-mode="score"]');
  assert.equal(await page.locator('.modal .result-mode-panels').evaluate((element) => element.getBoundingClientRect().height), panelHeight,
    'switching result modes keeps the dialog content height');
  await page.click('.modal [data-result-mode="winner"]');

  await page.locator('.modal label.tournament-result-pick:has(input[value="-1"])').click();
  const selectedBackground = await page.locator('.modal .tournament-result-pick.is-selected').evaluate((element) => getComputedStyle(element).backgroundColor);
  const unselectedBackground = await page.locator('.modal .tournament-result-pick:not(.is-selected)').first().evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.equal(selectedBackground, unselectedBackground, 'winner selection uses an outline without a filled success background');
  await page.click('.modal [data-result-save]');

  await page.waitForFunction(() => !!document.querySelector('[data-edit-draw-result]'));
  await openMatchmakingHistory();
  await page.waitForSelector('.matchmaking-history-item .matchmaking-history-meta .tournament-fixture-score:has-text("Remis")');
  const recordedMatch = page.locator('.matchmaking-history-item:has([data-edit-draw-result])').first();
  assert.equal(await recordedMatch.locator('.matchmaking-history-title strong').count(), 1);
  if (await recordedMatch.locator('.matchmaking-history-toggle').getAttribute('aria-expanded') === 'false') {
    await recordedMatch.locator('.matchmaking-history-toggle').click();
  }
  assert.equal(await recordedMatch.locator('.matchmaking-history-players strong').innerText(), alice.name);
  assert.equal(await recordedMatch.locator('.matchmaking-history-team .team-skill-total').count(), 2);
  await page.setViewportSize({ width: 1280, height: 844 });
  assert.equal(await recordedMatch.locator('.matchmaking-history-teams').evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length), 4);
  await page.setViewportSize({ width: 390, height: 844 });
  const historyActions = await page.locator('.matchmaking-history-item:has([data-edit-draw-result]) .matchmaking-draw-actions').first()
    .locator('button').evaluateAll((buttons) => buttons.map((button) =>
      button.hasAttribute('data-edit-draw-result') ? 'edit' : button.hasAttribute('data-delete-draw') ? 'delete' : button.textContent?.trim()));
  assert.deepEqual(historyActions, ['edit', 'Rematch', 'delete']);
});

flowTest('matchmaking Historie derives the winner from values entered in the draw result dialog', async () => {
  // Values mode: the higher value wins, places follow the values, and the
  // recorded draw shows its winner with the "Win" chip in Historie. A field
  // left empty counts as its "0" placeholder instead of blocking the save.
  await openTeams();
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  const openTile = page.locator('.matchmaking-open-draws');
  if ((await openTile.getAttribute('open')) === null) await openTile.locator('summary').click();
  await page.waitForSelector('#match-history-open [data-record-draw]');
  await page.click('#match-history-open [data-record-draw]');

  await page.click('[data-result-mode="score"]');
  await page.fill('#draw-result-score-0', '3');
  assert.equal(await page.inputValue('#draw-result-score-1'), '');
  await page.click('.modal [data-result-save]');

  await page.waitForFunction(() => !!document.querySelector('[data-edit-draw-result]'));
  await openMatchmakingHistory();
  const winnerTeam = page.locator('.matchmaking-history-team:not(.is-loser)').first();
  await winnerTeam.waitFor();
  assert.equal(await winnerTeam.locator('.lb-rank.is-first').innerText(), '1');
  assert.equal(await winnerTeam.locator('.matchmaking-history-team-score').innerText(), '3');
  const loserTeam = page.locator('.matchmaking-history-team.is-loser').first();
  assert.equal(await loserTeam.locator('.lb-rank').innerText(), '2');
  assert.equal(await loserTeam.locator('.matchmaking-history-team-score').innerText(), '0');
  await page.click('[data-history-filter="tournaments"]');
  assert.equal(await page.getAttribute('[data-history-filter="tournaments"]', 'aria-pressed'), 'true');
  assert.equal(await page.locator('.matchmaking-history-team').count(), 0);
  await page.click('[data-history-filter="matches"]');
  await page.waitForSelector('.matchmaking-history-item [data-edit-draw-result]');
  assert.equal(await page.getAttribute('[data-history-filter="matches"]', 'aria-pressed'), 'true');
});

flowTest('shared filters narrow open games and history while keeping running tournaments visible', async (t) => {
  await openTeams();
  const gameId = await page.inputValue('#mm-game');
  const drawIds: string[] = [];
  const tournamentIds: string[] = [];
  let extraId = '';
  t.after(async () => {
    for (const id of tournamentIds) await page.request.delete(`${BASE_URL}/api/tournaments/${id}`);
    for (const id of drawIds) await page.request.delete(`${BASE_URL}/api/matchmaking/draws/${id}`);
    if (extraId) await page.request.delete(`${BASE_URL}/api/players/${extraId}`);
    await page.reload();
  });
  const extra = await page.request.post(`${BASE_URL}/api/players`, { data: { name: 'Filter Teilnehmer' } });
  assert.equal(extra.status(), 201, await extra.text());
  extraId = (await extra.json()).id;
  const createDraw = async (playerIds: string[], recorded: boolean) => {
    const response = await page.request.post(`${BASE_URL}/api/matchmaking`, {
      data: { gameId, playerIds, teamCount: 2 },
    });
    assert.equal(response.status(), 200, await response.text());
    const draw = await response.json() as { id: string; teams: Array<{ players: Array<{ id: string }> }> };
    drawIds.push(draw.id);
    if (recorded) {
      const result = await page.request.post(`${BASE_URL}/api/matches`, {
        data: { gameId, drawId: draw.id, winnerTeamIndex: 0,
          teams: draw.teams.map((team) => ({ playerIds: team.players.map((player) => player.id) })) },
      });
      assert.equal(result.status(), 201, await result.text());
    }
    return draw.id;
  };
  const createTournament = async (playerIds: string[], completed: boolean) => {
    const response = await page.request.post(`${BASE_URL}/api/tournaments`, {
      data: { gameId, format: 'single_elimination', teams: playerIds.map((id) => ({ playerIds: [id] })) },
    });
    assert.equal(response.status(), 201, await response.text());
    const tournament = await response.json() as { id: string; matches: Array<{ id: string; teamAId: string }> };
    tournamentIds.push(tournament.id);
    if (completed) {
      const match = tournament.matches[0];
      const result = await page.request.post(`${BASE_URL}/api/tournaments/${tournament.id}/matches/${match.id}/result`, {
        data: { winnerTeamId: match.teamAId },
      });
      assert.equal(result.status(), 200, await result.text());
    }
    return tournament.id;
  };
  const mineOpen = await createDraw([alice.id, bob.id], false);
  const otherOpen = await createDraw([bob.id, extraId], false);
  const minePlayed = await createDraw([alice.id, bob.id], true);
  const otherPlayed = await createDraw([bob.id, extraId], true);
  const mineRunning = await createTournament([alice.id, bob.id], false);
  const otherRunning = await createTournament([bob.id, extraId], false);
  const mineFinished = await createTournament([alice.id, bob.id], true);
  const otherFinished = await createTournament([bob.id, extraId], true);
  const drawTile = (id: string) => page.locator(`.matchmaking-history-item:has([data-history-toggle="${id}"]), .matchmaking-history-item:has([data-history-toggle="o-${id}"])`);
  const tournamentTile = (id: string) => page.locator(`.matchmaking-history-item:has([data-history-toggle="t-${id}"])`);

  await page.reload();
  await page.locator('#mm-game-search').click();
  await page.locator(`#mm-game-list [data-search-select-value="${gameId}"]`).click();
  const filters = page.getByRole('group', { name: 'Spiele und Turniere filtern' });
  await filters.waitFor();
  assert.equal(await filters.isVisible(), true, 'filters remain reachable with both sections closed');
  await page.locator('.matchmaking-open-draws > summary').click();
  await openMatchmakingHistory();
  await drawTile(otherOpen).waitFor();
  await tournamentTile(otherFinished).waitFor();
  assert.equal(await filters.evaluate((element) => Boolean(element.compareDocumentPosition(
    document.querySelector('.matchmaking-open-draws')!) & Node.DOCUMENT_POSITION_FOLLOWING)), true);

  const ownResponse = page.waitForResponse((response) => response.url().includes('/api/matchmaking/history?')
    && new URL(response.url()).searchParams.get('mine') === '1' && response.status() === 200);
  await filters.getByRole('button', { name: 'Meine', exact: true }).focus();
  await page.keyboard.press('Enter');
  await ownResponse;
  await drawTile(mineOpen).waitFor();
  assert.equal(await filters.getByRole('button', { name: 'Meine', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await drawTile(otherOpen).count(), 0);
  assert.equal(await drawTile(otherPlayed).count(), 0);
  assert.equal(await tournamentTile(otherRunning).count(), 0);
  assert.equal(await tournamentTile(otherFinished).count(), 0);
  assert.equal(await page.locator(`.matchmaking-active-tournaments [data-open-draw-tournament="${otherRunning}"]`).count(), 1,
    'the running-tournament overview remains independent of the participation filter');
  assert.equal(await drawTile(minePlayed).count(), 1);
  assert.equal(await tournamentTile(mineRunning).count(), 1);
  assert.equal(await tournamentTile(mineFinished).count(), 1);

  await filters.getByRole('button', { name: 'Matches', exact: true }).click();
  await drawTile(mineOpen).waitFor();
  assert.equal(await tournamentTile(mineRunning).count(), 0);
  assert.equal(await tournamentTile(mineFinished).count(), 0);
  assert.equal(await page.locator(`.matchmaking-active-tournaments [data-open-draw-tournament="${mineRunning}"]`).count(), 1);
  assert.equal(await page.locator(`.matchmaking-active-tournaments [data-open-draw-tournament="${otherRunning}"]`).count(), 1,
    'the running-tournament overview remains visible when only matches are requested');
  await filters.getByRole('button', { name: 'Turniere', exact: true }).click();
  await tournamentTile(mineRunning).waitFor();
  assert.equal(await drawTile(mineOpen).count(), 0);
  assert.equal(await drawTile(minePlayed).count(), 0);
  assert.equal(await tournamentTile(mineFinished).count(), 1);
  await filters.getByRole('button', { name: 'Alle', exact: true }).click();
  await filters.getByRole('button', { name: 'Meine', exact: true }).click();
  await drawTile(otherOpen).waitFor();
  assert.equal(await tournamentTile(otherFinished).count(), 1);

  // Members can view all four card types, but only admins can delete them.
  const memberContext = await browser.newContext();
  try {
    await addSessionCookie(memberContext, BASE_URL, bob.cookie);
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`${BASE_URL}/#matchmaking`);
    await memberPage.locator('#mm-game-search').click();
    await memberPage.locator(`#mm-game-list [data-search-select-value="${gameId}"]`).click();
    await memberPage.locator('.matchmaking-open-draws > summary').click();
    await memberPage.locator('details.history-details:has(summary:has-text("Historie")) > summary').click();
    await memberPage.locator(`[data-history-toggle="o-${mineOpen}"]`).waitFor();
    await memberPage.locator(`[data-history-toggle="${minePlayed}"]`).waitFor();
    await memberPage.locator(`[data-history-toggle="t-${mineRunning}"]`).waitFor();
    await memberPage.locator(`[data-history-toggle="t-${mineFinished}"]`).waitFor();
    assert.equal(await memberPage.locator('[data-delete-draw], [data-delete-tournament]').count(), 0,
      'a member never sees delete actions on open or completed game and tournament cards');
    await memberPage.locator(`[data-open-draw-tournament="${mineFinished}"]`).click();
    await memberPage.locator('.tournament-board').waitFor();
    assert.equal(await memberPage.locator('#tourn-delete').count(), 0);
  } finally {
    await memberContext.close();
  }
});

flowTest('match history reports failed tournament and older-match requests', async () => {
  const tournamentsUrl = '**/api/tournaments';
  await page.route(tournamentsUrl, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline"}' }));
  try {
    await page.reload();
    await page.waitForSelector('#mm-generate');
    await page.click('[data-history-filter="tournaments"]');
    // The filters are now outside the disclosure. Open the error detail
    // after the failed request has settled so this checks its visible message.
    await page.getByText('Historie konnte nicht geladen werden.', { exact: true }).waitFor({ state: 'attached' });
    await openMatchmakingHistory();
    await page.getByText('Historie konnte nicht geladen werden.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Lädt…', { exact: true }).count(), 0);
  } finally {
    await page.unroute(tournamentsUrl);
  }

  // A reload can select another catalog game than the previous flow used.
  // Give this exact game one recorded result so the mocked next page remains
  // meaningful now that open rerolls no longer occupy the match cursor.
  const gameId = await page.inputValue('#mm-game');
  const draw = await page.request.post(`${BASE_URL}/api/matchmaking`, {
    data: { gameId, playerIds: [alice.id, bob.id], teamCount: 2 },
  });
  assert.equal(draw.status(), 200, await draw.text());
  const drawn = await draw.json() as { id: string; teams: Array<{ players: Array<{ id: string }> }> };
  const recorded = await page.request.post(`${BASE_URL}/api/matches`, {
    data: {
      gameId,
      teams: drawn.teams.map((team) => ({ playerIds: team.players.map((player) => player.id) })),
      winnerTeamIndex: 0,
      drawId: drawn.id,
    },
  });
  assert.equal(recorded.status(), 201, await recorded.text());

  const historyUrl = '**/api/matchmaking/history?*';
  await page.route(historyUrl, async (route) => {
    if (new URL(route.request().url()).searchParams.has('before')) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline"}' });
      return;
    }
    const response = await route.fetch();
    const payload = await response.json();
    assert.ok(payload.history.length > 0);
    const last = payload.history.at(-1);
    payload.nextCursor = { before: last.generatedAt, beforeId: last.id };
    await route.fulfill({ response, body: JSON.stringify(payload) });
  });
  try {
    await page.reload();
    await page.waitForSelector('#mm-generate');
    await openMatchmakingHistory();
    await page.locator('[data-history-more]').click();
    await page.getByText('Historie konnte nicht vollständig geladen werden.', { exact: true }).waitFor();
  } finally {
    await page.unroute(historyUrl);
  }
});

flowTest('match history keeps loaded older games after a realtime refresh', async (t) => {
  await openTeams();
  const gameId = await page.inputValue('#mm-game');
  const draw = await page.request.post(`${BASE_URL}/api/matchmaking`, {
    data: { gameId, playerIds: [alice.id, bob.id], teamCount: 2 },
  });
  assert.equal(draw.status(), 200, await draw.text());
  const drawn = await draw.json() as { id: string; teams: Array<{ players: Array<{ id: string }> }> };
  const result = await page.request.post(`${BASE_URL}/api/matches`, {
    data: {
      gameId,
      teams: drawn.teams.map((team) => ({ playerIds: team.players.map((player) => player.id) })),
      winnerTeamIndex: 0,
      drawId: drawn.id,
    },
  });
  assert.equal(result.status(), 201, await result.text());

  const historyUrl = '**/api/matchmaking/history?*';
  const baseTime = Date.now();
  let addedNewMatch = false;
  let template: Record<string, unknown> | null = null;
  await page.route(historyUrl, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('gameId') !== gameId) return route.continue();
    if (!template) {
      const response = await route.fetch();
      const payload = await response.json();
      template = payload.history[0];
      assert.ok(template, 'the selected game needs a real recorded match as a template');
    }
    const entries = Array.from({ length: 45 }, (_, index) => ({
      ...template, id: `history-refresh-${index}`, generatedAt: baseTime - index * 1000,
    }));
    if (addedNewMatch) entries.unshift({ ...template, id: 'history-refresh-new', generatedAt: baseTime + 1000 });
    const cursorId = url.searchParams.get('beforeId');
    const start = cursorId ? entries.findIndex((entry) => entry.id === cursorId) + 1 : 0;
    const limit = Number(url.searchParams.get('limit') || 20);
    const history = entries.slice(start, start + limit);
    const last = history.at(-1);
    const nextCursor = start + limit < entries.length && last
      ? { before: last.generatedAt, beforeId: last.id } : null;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ history, nextCursor, openDraws: [] }) });
  });
  t.after(async () => {
    await page.unroute(historyUrl);
    await page.reload();
  });

  await page.reload();
  await page.waitForSelector('#mm-generate');
  await openMatchmakingHistory();
  await page.locator('[data-history-more]').click();
  await page.waitForFunction(() => document.querySelectorAll('.history-details .matchmaking-history-item:has([data-edit-draw-result])').length === 40);
  await page.locator('[data-history-more]').click();
  await page.waitForFunction(() => document.querySelectorAll('.history-details .matchmaking-history-item:has([data-edit-draw-result])').length === 45);
  const oldest = await page.locator('.history-details .matchmaking-history-item:has([data-edit-draw-result]) [data-history-toggle]').last().getAttribute('data-history-toggle');
  addedNewMatch = true;
  const nextDraw = await page.request.post(`${BASE_URL}/api/matchmaking`, {
    data: { gameId, playerIds: [alice.id, bob.id], teamCount: 2 },
  });
  assert.equal(nextDraw.status(), 200, await nextDraw.text());
  const nextTeams = (await nextDraw.json() as { id: string; teams: Array<{ players: Array<{ id: string }> }> });
  const nextResult = await page.request.post(`${BASE_URL}/api/matches`, {
    data: {
      gameId,
      teams: nextTeams.teams.map((team) => ({ playerIds: team.players.map((player) => player.id) })),
      winnerTeamIndex: 0,
      drawId: nextTeams.id,
    },
  });
  assert.equal(nextResult.status(), 201, await nextResult.text());
  await page.waitForFunction(() => document.querySelectorAll('.history-details .matchmaking-history-item:has([data-edit-draw-result])').length === 46);
  assert.equal(await page.locator('.history-details .matchmaking-history-item:has([data-edit-draw-result]) [data-history-toggle]').last().getAttribute('data-history-toggle'), oldest);
  assert.equal(await page.locator('[data-history-more]').count(), 0);
});

flowTest('an open game can be deleted from its own card after confirmation', async () => {
  await openTeams();
  const gameId = await page.inputValue('#mm-game');
  const response = await page.request.post(`${BASE_URL}/api/matchmaking`, {
    data: { gameId, playerIds: [alice.id, bob.id], teamCount: 2 },
  });
  assert.equal(response.status(), 200, await response.text());
  const draw = await response.json() as { id: string };
  const openSection = page.locator('.matchmaking-open-draws');
  await openSection.waitFor();
  if (!(await openSection.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await openSection.locator('summary').click();
  }
  const deleteButton = openSection.locator(`[data-delete-draw="${draw.id}"]`);
  await deleteButton.click();
  await page.getByRole('alertdialog', { name: 'Spiel löschen' }).getByRole('button', { name: 'Löschen' }).click();
  if (await page.locator('#reauth-form').isVisible()) {
    await page.fill('#reauth-password', alice.password);
    await page.locator('#reauth-form button[type="submit"]').click();
  }
  await deleteButton.waitFor({ state: 'detached' });
  const history = await page.request.get(`${BASE_URL}/api/matchmaking/history?gameId=${gameId}&kind=matches`);
  assert.equal((await history.json()).openDraws.some((entry: { id: string }) => entry.id === draw.id), false);
});

flowTest('Ergebnis eintragen keeps a manual team reassignment after changing "Anzahl Teams"', async () => {
  // Regression test: reassigning a player to a different team in the entry
  // form, then changing "Anzahl Teams", must not silently revert that player
  // back to the original drawn team.
  // Drawn lineups use their own compact result dialog; the free result form
  // lives in Auswertung.
  await openAuswertungTab('leaderboard');
  await page.click('#add-match-btn');
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

flowTest('Ergebnis eintragen keeps Frei-für-alle usable with more than six people', async () => {
  for (let index = 1; index <= 7; index++) {
    const created = await page.request.post(`${BASE_URL}/api/players`, { data: { name: `FFA Probe ${index}` } });
    assert.equal(created.status(), 201);
  }
  await page.reload();
  await waitForPlayerData(page);
  await openAuswertungTab('leaderboard');
  await page.click('#add-match-btn');
  await page.check('#match-ffa');
  const participants = page.locator('[data-ffa-player]');
  assert.ok(await participants.count() > 6);
  await page.locator('.modal label.tournament-result-pick:has(input[value="-1"])').click();
  assert.equal(await page.locator('input[name="admin-result-winner"][value="-1"]').isChecked(), true);
  await page.click('#match-form [data-result-mode="score"]');
  assert.equal(await page.locator('#match-form .result-score-row').count(), await participants.count());
  assert.equal(await page.locator('#match-form').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  await page.fill('#admin-result-score-0', '7');
  const firstFfaPlayerId = await participants.first().getAttribute('data-ffa-player');
  await participants.first().focus();
  await participants.first().uncheck();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-ffa-player')), firstFfaPlayerId);
  await participants.first().check();
  assert.equal(await page.inputValue('#admin-result-score-0'), '7', 're-adding a participant restores their score');
  assert.equal(await page.locator('input[name="admin-result-winner"][value="-1"]').isChecked(), true);
  await page.click('.modal[aria-label="Ergebnis eintragen"] [data-close]');
  await page.click('.modal[aria-label="Änderungen verwerfen?"] [data-confirm]');
});

flowTest('Auswertungen (via Mehr) shows a real award and keeps detail logs collapsed', async () => {
  // Create a player + a session via the real agent-report endpoint (not the
  // UI) so there's an actual play_sessions row to render.
  const account = await createE2EAccount(BASE_URL, adminCookie, 'Analytics E2E Player');
  const playerRes = await page.request.get(`${BASE_URL}/api/players/${account.id}`);
  assert.equal(playerRes.status(), 200);
  const player = await playerRes.json() as { api_key: string };
  // The permanently open base workspace is not trackable, so this needs a real
  // LAN period the account is accepted to and has selected — the same sequence
  // an organizer walks through in production.
  const now = Date.now();
  const createdEvent = await page.request.post(`${BASE_URL}/api/events`, {
    data: { name: 'Auswertung E2E LAN', startsAt: now - 1_000, endsAt: now + 3_600_000 },
  });
  assert.equal(createdEvent.status(), 201, await createdEvent.text());
  const activeEvent = await createdEvent.json() as { id: string };
  // Both identities join the new period: the tracked account produces the
  // session, and the admin browsing Auswertung needs access to its data. The
  // admin keeps the base workspace selected — the analytics filter below is
  // what widens the view.
  const meResponse = await page.request.get(`${BASE_URL}/api/me`);
  assert.equal(meResponse.status(), 200, await meResponse.text());
  const admin = await meResponse.json() as { id: string };
  const invited = await page.request.put(`${BASE_URL}/api/events/${activeEvent.id}/participants`, {
    data: { playerIds: [account.id, admin.id] },
  });
  assert.equal(invited.status(), 200, await invited.text());
  for (const cookie of [account.cookie, adminCookie]) {
    const accepted = await fetch(`${BASE_URL}/api/events/${activeEvent.id}/invitation/accept`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(accepted.status, 200, await accepted.text());
  }
  const selected = await fetch(`${BASE_URL}/api/me/active-event`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({ eventId: activeEvent.id }),
  });
  assert.equal(selected.status, 200, await selected.text());
  const trackingResponse = await page.request.post(`${BASE_URL}/api/events/${activeEvent.id}/tracking/start`);
  assert.equal(trackingResponse.status(), 200, await trackingResponse.text());
  const consentResponse = await fetch(`${BASE_URL}/api/events/${activeEvent.id}/tracking-consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({ granted: true, textVersion: TRACKING_CONSENT_TEXT_VERSION }),
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
  // Earlier tests in this suite recorded their 1v1 results in the permanently
  // open base workspace, while the play session above belongs to the separate
  // LAN period, because the base workspace is not trackable. "Gesamt (alle
  // Events)" is the one selection that shows both at once.
  await page.click('[data-search-select]:has(#an-event-search) .search-select-toggle');
  await page.click('#an-event-list [data-search-select-value=""]');
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
