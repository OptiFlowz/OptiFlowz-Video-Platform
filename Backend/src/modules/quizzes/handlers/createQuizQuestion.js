import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

const optionSchema = z.object({
  option_text: z.string().trim().min(1),
  is_correct: z.boolean().optional().default(false),
  position: z.coerce.number().int().min(1).optional().nullable(),
});

const pairSchema = z.object({
  left_text: z.string().trim().min(1),
  right_text: z.string().trim().min(1),
  position: z.coerce.number().int().min(1).optional().nullable(),
});

function prerequisites(object, userId) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quiz ID'),
    video_id: z.string().uuid('Invalid quiz ID').optional().nullable(),
    playlist_id: z.string().uuid('Invalid playlist ID').optional().nullable(),
    question_text: z.string().trim().min(1),
    question_type: z.enum(['single_choice', 'multiple_choice', 'matching']),
    explanation: z.string().trim().max(5000).optional().nullable(),
    points: z.coerce.number().int().min(1).max(100).optional().default(1),
    position: z.coerce.number().int().min(1).optional().nullable(),
    is_active: z.boolean().optional().default(true),
    options: z.array(optionSchema).optional().default([]),
    pairs: z.array(pairSchema).optional().default([]),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const data = validateOrThrow(schema.safeParse(object));

  if (['single_choice', 'multiple_choice'].includes(data.question_type) && data.options.length < 2) {
    const error = new Error('Choice questions must have at least 2 options');
    error.status = 400;
    throw error;
  }

  if (data.question_type === 'single_choice') {
    const correctCount = data.options.filter((option) => option.is_correct).length;
    if (correctCount !== 1) {
      const error = new Error('Single choice question must have exactly one correct option');
      error.status = 400;
      throw error;
    }
  }

  if (data.question_type === 'multiple_choice') {
    const correctCount = data.options.filter((option) => option.is_correct).length;
    if (correctCount < 1) {
      const error = new Error('Multiple choice question must have at least one correct option');
      error.status = 400;
      throw error;
    }
  }

  if (data.question_type === 'matching' && data.pairs.length < 2) {
    const error = new Error('Matching questions must have at least 2 pairs');
    error.status = 400;
    throw error;
  }

  return data;
}

async function getFullQuestion(client, questionId) {
  const questionResult = await client.query(
    `
      SELECT *
      FROM quiz_questions
      WHERE id = $1
      LIMIT 1
    `,
    [questionId]
  );

  const question = questionResult.rows[0] || null;

  if (!question) {
    return null;
  }

  const optionsResult = await client.query(
    `
      SELECT *
      FROM quiz_question_options
      WHERE question_id = $1
      ORDER BY position ASC
    `,
    [questionId]
  );

  const pairsResult = await client.query(
    `
      SELECT *
      FROM quiz_matching_pairs
      WHERE question_id = $1
      ORDER BY position ASC
    `,
    [questionId]
  );

  return {
    ...question,
    options: optionsResult.rows,
    pairs: pairsResult.rows,
  };
}

export async function createQuizQuestionInternal(object, userId = null) {
  const data = prerequisites(object, userId);

  await assertQuizOwner(data.quizId, userId);

  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const questionResult = await client.query(
      `
        INSERT INTO quiz_questions (
          quiz_id,
          question_text,
          question_type,
          explanation,
          points,
          position,
          is_active,
          video_id,
          playlist_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *
      `,
      [
        data.quizId,
        data.question_text,
        data.question_type,
        data.explanation || null,
        data.points,
        data.position || null,
        data.is_active,
        data.video_id,
        data.playlist_id || null
      ]
    );

    const question = questionResult.rows[0];

    if (data.question_type === 'single_choice' || data.question_type === 'multiple_choice') {
      for (let i = 0; i < data.options.length; i += 1) {
        const option = data.options[i];

        await client.query(
          `
            INSERT INTO quiz_question_options (
              question_id,
              option_text,
              is_correct,
              position
            )
            VALUES ($1,$2,$3,$4)
          `,
          [
            question.id,
            option.option_text,
            option.is_correct,
            option.position || i + 1,
          ]
        );
      }
    }

    if (data.question_type === 'matching') {
      for (let i = 0; i < data.pairs.length; i += 1) {
        const pair = data.pairs[i];

        await client.query(
          `
            INSERT INTO quiz_matching_pairs (
              question_id,
              left_text,
              right_text,
              position
            )
            VALUES ($1,$2,$3,$4)
          `,
          [
            question.id,
            pair.left_text,
            pair.right_text,
            pair.position || i + 1,
          ]
        );
      }
    }

    const fullQuestion = await getFullQuestion(client, question.id);

    await client.query('COMMIT');

    return fullQuestion;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
