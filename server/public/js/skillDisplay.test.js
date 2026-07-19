import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from './state.js';
import { teamSkillHtml, teamSkillTotal, UNRATED_SKILL_VALUE } from './skillDisplay.js';

test('teamSkillTotal sums the selected game and counts missing ratings as zero', () => {
  const previousSkills = state.skills;
  state.skills = [
    { player_id: 'p1', game_id: 'g1', rating: 8 },
    { player_id: 'p2', game_id: 'other-game', rating: 10 },
  ];

  try {
    assert.equal(teamSkillTotal([{ id: 'p1' }, { id: 'p2' }], 'g1'), 8 + UNRATED_SKILL_VALUE);
    assert.match(teamSkillHtml([{ id: 'p1' }, { id: 'p2' }], 'g1'), /Gesamt-Skill 8/);
  } finally {
    state.skills = previousSkills;
  }
});
