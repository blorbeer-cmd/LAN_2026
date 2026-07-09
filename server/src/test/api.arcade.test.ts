import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db';

const app = createApp();

test('GET /api/arcade/stats summarizes completed quiz results', async () => {
  const alice = await request(app).post('/api/players').send({ name: 'Arcade Alice' });
  const bob = await request(app).post('/api/players').send({ name: 'Arcade Bob' });
  const now = Date.now();
  const scores = [
    { playerId: alice.body.id, name: alice.body.name, score: 5 },
    { playerId: bob.body.id, name: bob.body.name, score: 3 },
  ];

  db.prepare(
    `INSERT INTO arcade_results (id, game_type, winner_id, players, scores, reason, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('arcade-test-result', 'quiz', alice.body.id, JSON.stringify(scores), JSON.stringify(scores), 'completed', now - 1000, now);

  const res = await request(app).get('/api/arcade/stats');
  assert.equal(res.status, 200);
  const quiz = res.body.games.find((game: { gameType: string }) => game.gameType === 'quiz');
  assert.equal(quiz.title, 'Gaming-Quiz');
  assert.equal(quiz.matches, 1);
  assert.equal(quiz.leader.name, 'Arcade Alice');
  assert.equal(quiz.players[0].wins, 1);
  assert.equal(quiz.players[0].points, 5);
});
