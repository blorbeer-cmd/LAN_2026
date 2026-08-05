import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from './state.js';
import {
  playerSkillHtml,
  teamSkillHtml,
  teamSkillTotal,
  unratedPlayerCount,
  UNRATED_SKILL_VALUE,
} from './skillDisplay.js';

function withSkills(skills, run) {
  const previousSkills = state.skills;
  state.skills = skills;
  try {
    run();
  } finally {
    state.skills = previousSkills;
  }
}

const ratedPlayers = [
  { player_id: 'p1', game_id: 'g1', rating: 8 },
  { player_id: 'p2', game_id: 'other-game', rating: 10 },
];

test('teamSkillTotal sums the selected game and counts missing ratings with the draw fallback', () => {
  withSkills(ratedPlayers, () => {
    assert.equal(teamSkillTotal([{ id: 'p1' }, { id: 'p2' }], 'g1'), 8 + UNRATED_SKILL_VALUE);
    assert.equal(unratedPlayerCount([{ id: 'p1' }, { id: 'p2' }], 'g1'), 1);
  });
});

test('teamSkillHtml appends how many players entered without an own rating', () => {
  withSkills(ratedPlayers, () => {
    const html = teamSkillHtml([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], 'g1');
    assert.match(html, /18 <span class="rating-unrated">\(2\)<\/span>/);
    assert.match(html, /Gesamt-Skill 18, davon 2 ohne eigene Bewertung mit je 5/);
  });
});

test('teamSkillHtml stays a plain total when every player rated the game', () => {
  withSkills(
    [
      { player_id: 'p1', game_id: 'g1', rating: 8 },
      { player_id: 'p2', game_id: 'g1', rating: 3 },
    ],
    () => {
      const html = teamSkillHtml([{ id: 'p1' }, { id: 'p2' }], 'g1');
      assert.match(html, /aria-label="Gesamt-Skill 11"/);
      assert.doesNotMatch(html, /rating-unrated/);
    }
  );
});

test('playerSkillHtml shows the parenthesized fallback for a player without an own rating', () => {
  withSkills(ratedPlayers, () => {
    assert.match(playerSkillHtml({ id: 'p1' }, 'g1'), /aria-label="Skill-Level 8 von 10"/);

    const unrated = playerSkillHtml({ id: 'p3' }, 'g1');
    assert.match(unrated, /class="rating rating-unrated"/);
    assert.match(unrated, /<span>\(5\)<\/span>/);
    assert.match(unrated, /Ohne eigene Bewertung, zählt mit Skill-Level 5 von 10/);
  });
});

// A captain draft picks by turn order and never reads ratings, so nothing may
// claim a missing one "counts as 5" or is part of a balanced total there.
test('an unbalanced lineup keeps the en dash and leaves missing ratings out of the total', () => {
  withSkills(ratedPlayers, () => {
    const options = { balanced: false };
    const unrated = playerSkillHtml({ id: 'p3' }, 'g1', options);
    assert.match(unrated, /<span>–<\/span>/);
    assert.match(unrated, /Noch kein Skill-Level eingetragen/);
    assert.doesNotMatch(unrated, /zählt mit/);

    const html = teamSkillHtml([{ id: 'p1' }, { id: 'p3' }], 'g1', options);
    assert.equal(teamSkillTotal([{ id: 'p1' }, { id: 'p3' }], 'g1', options), 8);
    assert.match(html, /aria-label="Gesamt-Skill 8"/);
    assert.doesNotMatch(html, /ohne eigene Bewertung/);
  });
});

// A recorded lineup shows the ratings the draw itself used. Rating the game
// afterwards must not rewrite what that draw is shown to have been balanced on.
test('a stored lineup keeps its snapshot ratings when the live state changes', () => {
  const snapshotPlayers = [
    { id: 'p1', rating: 8 },
    { id: 'p3', rating: null },
  ];
  const options = { stored: true };

  const render = () => ({
    total: teamSkillTotal(snapshotPlayers, 'g1', options),
    unrated: unratedPlayerCount(snapshotPlayers, 'g1', options),
    row: playerSkillHtml(snapshotPlayers[1], 'g1', options),
  });

  let beforeChange;
  withSkills(ratedPlayers, () => {
    beforeChange = render();
  });
  assert.deepEqual(beforeChange, { total: 13, unrated: 1, row: beforeChange.row });
  assert.match(beforeChange.row, /<span>\(5\)<\/span>/);

  withSkills([...ratedPlayers, { player_id: 'p3', game_id: 'g1', rating: 9 }], () => {
    assert.deepEqual(render(), beforeChange);
  });
});
