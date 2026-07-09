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

test('GET /api/arcade/stats labels and aggregates tetris results too', async () => {
  const cara = await request(app).post('/api/players').send({ name: 'Tetris Cara' });
  const dan = await request(app).post('/api/players').send({ name: 'Tetris Dan' });
  const now = Date.now();
  const scores = [
    { playerId: cara.body.id, name: cara.body.name, score: 4200, lines: 21 },
    { playerId: dan.body.id, name: dan.body.name, score: 3100, lines: 15 },
  ];

  db.prepare(
    `INSERT INTO arcade_results (id, game_type, winner_id, players, scores, reason, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('tetris-test-result', 'tetris', cara.body.id, JSON.stringify(scores), JSON.stringify(scores), 'completed', now - 1000, now);

  const res = await request(app).get('/api/arcade/stats');
  assert.equal(res.status, 200);
  const tetris = res.body.games.find((game: { gameType: string }) => game.gameType === 'tetris');
  assert.equal(tetris.title, 'Tetris Battle');
  assert.equal(tetris.matches, 1);
  assert.equal(tetris.leader.name, 'Tetris Cara');
  assert.equal(tetris.players[0].wins, 1);
  assert.equal(tetris.players[0].points, 4200);
});
