import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object, userId) {
  const schema = z.object({
    attemptId: z.string().uuid('Invalid attempt ID'),
    questionId: z.string().uuid('Invalid question ID'),
    answer: z.any(),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse(object));
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String))].sort();
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function evaluateAnswer(client, question, answer) {
  const points = Number(question.points || 1);

  if (question.question_type === 'single_choice') {
    const selectedOptionId = answer?.optionId;

    if (!selectedOptionId) {
      return {
        result: 'incorrect',
        awarded_points: 0,
      };
    }

    const { rows } = await client.query(
      `
        SELECT id
        FROM quiz_question_options
        WHERE question_id = $1
          AND is_correct = true
      `,
      [question.id]
    );

    const correctOptionIds = rows.map(row => String(row.id));
    const isCorrect = correctOptionIds.includes(String(selectedOptionId));

    return {
      result: isCorrect ? 'correct' : 'incorrect',
      awarded_points: isCorrect ? points : 0,
    };
  }

  if (question.question_type === 'multiple_choice') {
    const selectedOptionIds = normalizeArray(answer?.optionIds);

    const { rows } = await client.query(
      `
        SELECT id, is_correct
        FROM quiz_question_options
        WHERE question_id = $1
      `,
      [question.id]
    );

    const correctOptionIds = normalizeArray(
      rows.filter(row => row.is_correct).map(row => row.id)
    );

    if (selectedOptionIds.length === 0 || correctOptionIds.length === 0) {
      return {
        result: 'incorrect',
        awarded_points: 0,
      };
    }

    const correctSelectedCount = selectedOptionIds.filter(id =>
      correctOptionIds.includes(id)
    ).length;

    const wrongSelectedCount = selectedOptionIds.filter(id =>
      !correctOptionIds.includes(id)
    ).length;

    const exactCorrect = arraysEqual(selectedOptionIds, correctOptionIds);

    const ratio = Math.max(
      0,
      (correctSelectedCount - wrongSelectedCount) / correctOptionIds.length
    );

    const awardedPoints = exactCorrect ? points : Number((points * ratio).toFixed(2));

    return {
      result:
        exactCorrect
          ? 'correct'
          : awardedPoints > 0
            ? 'partially_correct'
            : 'incorrect',
      awarded_points: awardedPoints,
    };
  }

  if (question.question_type === 'matching') {
    const submittedPairs = Array.isArray(answer?.pairs) ? answer.pairs : [];

    const { rows } = await client.query(
      `
        SELECT id, right_text
        FROM quiz_matching_pairs
        WHERE question_id = $1
      `,
      [question.id]
    );

    if (rows.length === 0 || submittedPairs.length === 0) {
      return {
        result: 'incorrect',
        awarded_points: 0,
      };
    }

    const correctMap = new Map(
      rows.map(row => [String(row.id), String(row.right_text).trim()])
    );

    let correctCount = 0;

    for (const pair of submittedPairs) {
      const pairId = String(pair?.pairId || '');
      const submittedRightText = String(pair?.rightText || '').trim();

      if (correctMap.get(pairId) === submittedRightText) {
        correctCount += 1;
      }
    }

    const ratio = correctCount / rows.length;
    const awardedPoints = Number((points * ratio).toFixed(2));

    return {
      result:
        correctCount === rows.length
          ? 'correct'
          : awardedPoints > 0
            ? 'partially_correct'
            : 'incorrect',
      awarded_points: awardedPoints,
    };
  }

  const error = new Error('Unsupported question type');
  error.status = 400;
  throw error;
}

export async function saveQuizAttemptAnswerInternal(object, userId = null) {
  const { attemptId, questionId, answer } = prerequisites(object, userId);

  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const attemptResult = await client.query(
      `
        SELECT *
        FROM quiz_attempts
        WHERE id = $1
          AND user_id = $2
        FOR UPDATE
      `,
      [attemptId, userId]
    );

    const attempt = attemptResult.rows[0];

    if (!attempt) {
      const error = new Error('Attempt not found');
      error.status = 404;
      throw error;
    }

    if (attempt.status !== 'in_progress') {
      const error = new Error('Attempt is not in progress');
      error.status = 400;
      throw error;
    }

    if (attempt.expires_at && new Date(attempt.expires_at) < new Date()) {
      await client.query(
        `
          UPDATE quiz_attempts
          SET status = 'expired'
          WHERE id = $1
        `,
        [attemptId]
      );

      const error = new Error('Attempt has expired');
      error.status = 400;
      throw error;
    }

    const questionResult = await client.query(
      `
        SELECT
          aq.id AS attempt_question_id,
          q.id,
          q.question_type,
          q.points
        FROM quiz_attempt_questions aq
        JOIN quiz_questions q ON q.id = aq.question_id
        WHERE aq.attempt_id = $1
          AND aq.question_id = $2
        LIMIT 1
      `,
      [attemptId, questionId]
    );

    const question = questionResult.rows[0];

    if (!question) {
      const error = new Error('Question not found in this attempt');
      error.status = 404;
      throw error;
    }

    const evaluation = await evaluateAnswer(client, question, answer);

    const { rows } = await client.query(
      `
        INSERT INTO quiz_attempt_questions (
          attempt_id,
          question_id,
          position,
          answer,
          result,
          awarded_points
        )
        VALUES (
          $1,
          $2,
          (
            SELECT position
            FROM quiz_attempt_questions
            WHERE attempt_id = $1
              AND question_id = $2
            LIMIT 1
          ),
          $3::jsonb,
          $4,
          $5
        )
        ON CONFLICT (attempt_id, question_id)
        DO UPDATE SET
          answer = EXCLUDED.answer,
          result = EXCLUDED.result,
          awarded_points = EXCLUDED.awarded_points
        RETURNING
          id,
          attempt_id,
          question_id,
          position,
          answer,
          result,
          awarded_points
      `,
      [
        attemptId,
        questionId,
        JSON.stringify(answer),
        evaluation.result,
        evaluation.awarded_points,
      ]
    );

    await client.query('COMMIT');

    return {
      answer: rows[0],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}