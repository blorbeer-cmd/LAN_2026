import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pointsRulesHtml } from './pointsRules.js';

const rules = {
  matchPointsByPosition: [4, 3, 2, 1], lastMatchPlacePoints: 1, tournamentPlacementPoints: [5, 3, 1],
  minimumSettledTips: 2, walletStart: 100, maximumStake: 20,
  orga: {
    completedForeignTodo: 3, organizedMatch: 1, completedTournament: 5,
    foodOrderByOtherParticipants: { minimum: 3, threeToFive: 3, sixToEight: 4, nineOrMore: 5 },
    ownFoodOrder: 1, completeSkills: 5, arrivalBeforeStart: 2, departureBeforeStart: 2,
    completedPoll: 3, completedGameVote: 2, minimumRespondents: 3,
  },
};

function value(html, title) {
  const row = html.split('role="listitem"').find((part) => part.includes(`ranked-list-title">${title}<`));
  assert.ok(row, `row ${title}`);
  return row.match(/ranked-list-value">([^<]*)</)[1];
}

test('the rules page shows the server rule set rather than fixed numbers', () => {
  const html = pointsRulesHtml({ rules: { ...rules, maximumStake: 25, orga: { ...rules.orga, completedForeignTodo: 4 } }, participantCount: 12 });
  assert.equal(value(html, 'Höchsteinsatz je Wette'), '25 P.');
  assert.equal(value(html, 'Fremdes To-do erledigt'), '4 P.');
  assert.equal(value(html, 'Sammelbestellung'), '3–5 P.');
  assert.equal(value(html, 'Platz 1'), '4 P.');
  assert.equal(value(html, 'Platz 4 und dahinter'), '1 P.');
  assert.equal(value(html, 'Turnier Platz 1'), '+5 P.');
  assert.match(html, /Bei aktuell 12 Teilnehmenden bringt Platz 1 also 12 P\. und Platz 12, falls er vergeben wird, 1 P\.<\/p>/);
  assert.match(html, /Unentschieden zu zweit: je 2 P\.\)/);
  assert.match(html, /3–5: 3 P\., 6–8: 4 P\., ab 9: 5 P\./);
});

test('the prize is escaped, optional, and the page waits for the rule set', () => {
  assert.equal(pointsRulesHtml({ settings: { prize_info: 'x' } }), '');
  const withPrize = pointsRulesHtml({ rules, participantCount: 1, settings: { prize_info: '<b>Pokal</b>' } });
  assert.match(withPrize, /&lt;b&gt;Pokal&lt;\/b&gt;/);
  assert.doesNotMatch(withPrize, /Bei aktuell/);
  assert.doesNotMatch(pointsRulesHtml({ rules, participantCount: 5, settings: { prize_info: '' } }), /Preis:/);
});
