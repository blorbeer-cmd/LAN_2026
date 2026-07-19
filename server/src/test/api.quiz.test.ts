import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let questionId: string;

test('GET /api/quiz/questions returns the seeded question catalog', async () => {
  const res = await request(app).get('/api/quiz/questions');
  assert.equal(res.status, 200);
  assert.ok(res.body.questions.length >= 100);
  assert.ok(res.body.questions.some((q: { question: string }) => q.question.includes('Super Mario')));
});

test('POST /api/quiz/questions validates question and answers', async () => {
  const noQuestion = await request(app).post('/api/quiz/questions').send({ answers: ['x'] });
  assert.equal(noQuestion.status, 400);
  const noAnswers = await request(app).post('/api/quiz/questions').send({ question: 'Test?' });
  assert.equal(noAnswers.status, 400);
});

test('POST /api/quiz/questions creates a manageable question', async () => {
  const res = await request(app).post('/api/quiz/questions').send({
    question: 'Welches Spiel testen wir gerade?',
    answers: ['Respawn Quiz', 'Gaming Quiz'],
    category: 'Test',
    difficulty: 'leicht',
  });
  assert.equal(res.status, 201);
  const created = res.body.questions.find((q: { question: string }) => q.question === 'Welches Spiel testen wir gerade?');
  assert.ok(created);
  assert.deepEqual(created.answers, ['Respawn Quiz', 'Gaming Quiz']);
  questionId = created.id;
});

test('PATCH /api/quiz/questions/:id updates a question', async () => {
  const res = await request(app).patch(`/api/quiz/questions/${questionId}`).send({
    question: 'Welches Quiz testen wir gerade?',
    answers: ['Gaming Quiz'],
  });
  assert.equal(res.status, 200);
  const updated = res.body.questions.find((q: { id: string }) => q.id === questionId);
  assert.equal(updated.question, 'Welches Quiz testen wir gerade?');
  assert.deepEqual(updated.answers, ['Gaming Quiz']);

  const missing = await request(app).patch('/api/quiz/questions/nope').send({ question: 'x' });
  assert.equal(missing.status, 404);
});

test('DELETE /api/quiz/questions/:id removes a question', async () => {
  const res = await request(app).delete(`/api/quiz/questions/${questionId}`);
  assert.equal(res.status, 204);
  const again = await request(app).delete(`/api/quiz/questions/${questionId}`);
  assert.equal(again.status, 404);
});
