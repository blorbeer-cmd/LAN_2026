import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db';

const app = createApp();

test('GET /api/arcade/lobbies returns the (empty) cross-game open-lobby list', async () => {
  // Lobbies are created over Socket.IO, which these HTTP-only tests don't
  // open — so the aggregate must cleanly report "none" rather than error.
  // A populated list is covered by the e2e quiz-lobby flow.
  const res = await request(app).get('/api/arcade/lobbies');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.lobbies, []);
});

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
  assert.equal(quiz.players[0].best, 5); // highscore (best single game)
  assert.equal(quiz.players[0].points, 5);
});

test('arcade stats rank by best single-game score, not duels won', async () => {
  const p = await request(app).post('/api/players').send({ name: 'HighScorer' });
  const q = await request(app).post('/api/players').send({ name: 'DuelWinner' });
  const now = Date.now();
  // Isolated game_type so this ranking check can't collide with other tests'
  // tetris rows in the shared in-memory DB.
  const mk = (id: string, aScore: number, bScore: number, winner: string) =>
    db
      .prepare(
        `INSERT INTO arcade_results (id, game_type, winner_id, players, scores, reason, started_at, ended_at)
         VALUES (?, 'pong', ?, ?, ?, 'completed', ?, ?)`
      )
      .run(
        id,
        winner,
        JSON.stringify([{ playerId: p.body.id }, { playerId: q.body.id }]),
        JSON.stringify([
          { playerId: p.body.id, name: p.body.name, score: aScore },
          { playerId: q.body.id, name: q.body.name, score: bScore },
        ]),
        now - 1000,
        now
      );
  // DuelWinner wins both duels but with modest scores; HighScorer loses both
  // yet posts a huge single-game score.
  mk('rank-1', 9000, 200, q.body.id);
  mk('rank-2', 100, 300, q.body.id);

  const res = await request(app).get('/api/arcade/stats');
  const game = res.body.games.find((g: { gameType: string }) => g.gameType === 'pong');
  assert.equal(game.leader.name, 'HighScorer'); // ranked by highscore, not wins
  assert.equal(game.players[0].best, 9000);
  assert.equal(game.players[0].wins, 0); // never won a duel
  assert.equal(game.players[1].name, 'DuelWinner');
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
  assert.equal(tetris.title, 'Tetris');
  assert.equal(tetris.matches, 1);
  assert.equal(tetris.leader.name, 'Tetris Cara');
  assert.equal(tetris.players[0].wins, 1);
  assert.equal(tetris.players[0].points, 4200);
});

test('GET /api/arcade/stats summarizes completed scribble results under their own title', async () => {
  const carla = await request(app).post('/api/players').send({ name: 'Arcade Carla' });
  const dave = await request(app).post('/api/players').send({ name: 'Arcade Dave' });
  const now = Date.now();
  const scores = [
    { playerId: carla.body.id, name: carla.body.name, score: 210 },
    { playerId: dave.body.id, name: dave.body.name, score: 90 },
  ];

  db.prepare(
    `INSERT INTO arcade_results (id, game_type, winner_id, players, scores, reason, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('arcade-test-scribble-result', 'scribble', carla.body.id, JSON.stringify(scores), JSON.stringify(scores), 'completed', now - 1000, now);

  const res = await request(app).get('/api/arcade/stats');
  assert.equal(res.status, 200);
  const scribble = res.body.games.find((game: { gameType: string }) => game.gameType === 'scribble');
  assert.equal(scribble.title, 'Scribble');
  assert.equal(scribble.matches, 1);
  assert.equal(scribble.leader.name, 'Arcade Carla');
});

test('GET /api/arcade/stats labels Blobby Volley results', async () => {
  const eve = await request(app).post('/api/players').send({ name: 'Blobby Eve' });
  const finn = await request(app).post('/api/players').send({ name: 'Blobby Finn' });
  const now = Date.now();
  const scores = [
    { playerId: eve.body.id, name: eve.body.name, score: 7 },
    { playerId: finn.body.id, name: finn.body.name, score: 4 },
  ];
  db.prepare(
    `INSERT INTO arcade_results (id, game_type, winner_id, players, scores, reason, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('arcade-test-blobby-result', 'blobby', eve.body.id, JSON.stringify(scores), JSON.stringify(scores), 'completed', now - 1000, now);

  const res = await request(app).get('/api/arcade/stats');
  const blobby = res.body.games.find((game: { gameType: string }) => game.gameType === 'blobby');
  assert.equal(blobby.title, 'Blobby Volley');
  assert.equal(blobby.rankingMode, 'winLoss');
  assert.equal(blobby.matches, 1);
  assert.equal(blobby.leader.name, 'Blobby Eve');
  assert.equal(blobby.players[0].best, 7);
  assert.equal(blobby.players[0].wins, 1);
  assert.equal(blobby.players[0].losses, 0);
  assert.equal(blobby.players[0].winRate, 1);
});
