import { Router } from 'express';
import { requireAdmin } from '../auth';
import { requireRecentReauthentication } from '../sessions';
import { writeAdminAudit } from '../adminAudit';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { isNonEmptyString } from '../validation';

export const quizRouter = Router();

const MAX_QUESTION_LENGTH = 240;
const MAX_ANSWER_LENGTH = 80;
const MAX_CATEGORY_LENGTH = 60;
const MAX_DIFFICULTY_LENGTH = 30;

interface QuizQuestionRow {
  id: string;
  question: string;
  answers: string;
  category: string | null;
  difficulty: string | null;
  created_at: number;
  seen_count: number;
}

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxLength ? trimmed : undefined;
}

function parseAnswers(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const answers = value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  if (answers.length === 0 || answers.length > 8) return undefined;
  if (answers.some((a) => a.length > MAX_ANSWER_LENGTH)) return undefined;
  return [...new Set(answers)];
}

function serializeQuestions() {
  const rows = db
    .prepare(
      `SELECT q.id, q.question, q.answers, q.category, q.difficulty, q.created_at,
              COUNT(s.question_id) AS seen_count
       FROM quiz_questions q
       LEFT JOIN quiz_seen s ON s.question_id = q.id
       GROUP BY q.id
       ORDER BY q.category COLLATE NOCASE, q.question COLLATE NOCASE`
    )
    .all() as QuizQuestionRow[];
  return {
    questions: rows.map((r) => ({
      id: r.id,
      question: r.question,
      answers: JSON.parse(r.answers),
      category: r.category,
      difficulty: r.difficulty,
      createdAt: r.created_at,
      seenCount: r.seen_count,
    })),
  };
}

quizRouter.get('/questions', (_req, res) => {
  res.json(serializeQuestions());
});

quizRouter.post('/questions', (req, res) => {
  const { question, answers, category, difficulty } = req.body ?? {};
  if (!isNonEmptyString(question, MAX_QUESTION_LENGTH)) {
    return res.status(400).json({ error: `Frage ist erforderlich (1-${MAX_QUESTION_LENGTH} Zeichen).` });
  }
  const parsedAnswers = parseAnswers(answers);
  if (!parsedAnswers) return res.status(400).json({ error: 'answers muss 1-8 kurze Antworten enthalten.' });
  const parsedCategory = optionalText(category, MAX_CATEGORY_LENGTH);
  if (parsedCategory === undefined) return res.status(400).json({ error: 'Kategorie ist zu lang.' });
  const parsedDifficulty = optionalText(difficulty, MAX_DIFFICULTY_LENGTH);
  if (parsedDifficulty === undefined) return res.status(400).json({ error: 'Schwierigkeit ist zu lang.' });

  db.prepare(
    'INSERT INTO quiz_questions (id, question, answers, category, difficulty, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(nanoid(), question.trim(), JSON.stringify(parsedAnswers), parsedCategory, parsedDifficulty, Date.now());
  res.status(201).json(serializeQuestions());
});

quizRouter.patch('/questions/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(req.params.id) as
    | QuizQuestionRow
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Frage nicht gefunden.' });

  const { question, answers, category, difficulty } = req.body ?? {};
  const nextQuestion =
    question === undefined ? existing.question : isNonEmptyString(question, MAX_QUESTION_LENGTH) ? question.trim() : undefined;
  if (nextQuestion === undefined) return res.status(400).json({ error: 'Frage ist ungültig.' });

  const parsedAnswers = answers === undefined ? JSON.parse(existing.answers) : parseAnswers(answers);
  if (!parsedAnswers) return res.status(400).json({ error: 'answers muss 1-8 kurze Antworten enthalten.' });
  const parsedCategory = optionalText(category, MAX_CATEGORY_LENGTH);
  if (parsedCategory === undefined && category !== undefined) return res.status(400).json({ error: 'Kategorie ist zu lang.' });
  const parsedDifficulty = optionalText(difficulty, MAX_DIFFICULTY_LENGTH);
  if (parsedDifficulty === undefined && difficulty !== undefined) {
    return res.status(400).json({ error: 'Schwierigkeit ist zu lang.' });
  }

  db.prepare('UPDATE quiz_questions SET question = ?, answers = ?, category = ?, difficulty = ? WHERE id = ?').run(
    nextQuestion,
    JSON.stringify(parsedAnswers),
    category === undefined ? existing.category : parsedCategory,
    difficulty === undefined ? existing.difficulty : parsedDifficulty,
    req.params.id
  );
  res.json(serializeQuestions());
});

quizRouter.delete('/questions/:id', requireAdmin, requireRecentReauthentication, (req, res) => {
  const result = db.prepare('DELETE FROM quiz_questions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Frage nicht gefunden.' });
  writeAdminAudit({ actorPlayerId: req.player?.id, action: 'quiz_question_deleted', targetType: 'quiz_question', targetId: req.params.id });
  res.status(204).end();
});
