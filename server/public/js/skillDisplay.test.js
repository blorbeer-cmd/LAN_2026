import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from './state.js';
import { DEFAULT_SKILL_RATING, teamSkillHtml, teamSkillTotal } from './skillDisplay.js';

test('teamSkillTotal sums the selected game and uses the neutral fallback for missing ratings', () => {
  const previousSkills = state.skills;
  state.skills = [
    { player_id: 'p1', game_id: 'g1', rating: 8 },
    { player_id: 'p2', game_id: 'other-game', rating: 10 },
  ];

  try {
    assert.equal(teamSkillTotal([{ id: 'p1' }, { id: 'p2' }], 'g1'), 8 + DEFAULT_SKILL_RATING);
    assert.match(teamSkillHtml([{ id: 'p1' }, { id: 'p2' }], 'g1'), /Gesamt-Skill 13/);
  } finally {
    state.skills = previousSkills;
  }
});
