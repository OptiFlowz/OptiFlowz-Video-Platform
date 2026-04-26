import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

const optionSchema = z.object({
  id: z.string().uuid().optional(),
  option_text: z.string().trim().min(1),
  is_correct: z.boolean().optional().default(false),
  position: z.coerce.number().int().min(1).optional().nullable(),
});

const pairSchema = z.object({
  id: z.string().uuid().optional(),
  left_text: z.string().trim().min(1),
  right_text: z.string().trim().min(1),
  position: z.coerce.number().int().min(1).optional().nullable(),
});

function prerequisites(object, userId) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quiz ID'),
    questionId: z.string().uuid('Invalid question ID'),
    question_text: z.string().trim().min(1).optional(),
    explanation: z.string().trim().max(5000).optional().nullable(),
    points: z.coerce.number().int().min(1).max(100).optional(),
    position: z.coerce.number().int().min(1).optional().nullable(),
    is_active: z.boolean().optional(),
    options: z.array(optionSchema).optional(),
    pairs: z.array(pairSchema).optional(),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse(object));
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
      ORDER BY position ASC, created_at ASC
    `,
    [questionId]
  );

  const pairsResult = await client.query(
    `
      SELECT *
      FROM quiz_matching_pairs
      WHERE question_id = $1
      ORDER BY position ASC, created_at ASC
    `,
    [questionId]
  );

  return {
    ...question,
    options: optionsResult.rows,
    pairs: pairsResult.rows,
  };
}

export async function updateQuizQuestionInternal(object, userId = null) {
  const data = prerequisites(object, userId);

  await assertQuizOwner(data.quizId, userId);

  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const questionResult = await client.query(
      `
        UPDATE quiz_questions
        SET
          question_text = COALESCE($2, question_text),
          explanation = COALESCE($3, explanation),
          points = COALESCE($4, points),
          position = COALESCE($5, position),
          is_active = COALESCE($6, is_active),
          updated_at = NOW()
        WHERE id = $1
          AND quiz_id = $7
        RETURNING *
      `,
      [
        data.questionId,
        data.question_text ?? null,
        data.explanation ?? null,
        data.points ?? null,
        data.position ?? null,
        data.is_active ?? null,
        data.quizId,
      ]
    );

    const question = questionResult.rows[0] || null;

    if (!question) {
      await client.query('COMMIT');
      return null;
    }

    if (data.options) {
      await client.query(
        'DELETE FROM quiz_question_options WHERE question_id = $1',
        [data.questionId]
      );

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
            data.questionId,
            option.option_text,
            option.is_correct,
            option.position || i + 1,
          ]
        );
      }
    }

    if (data.pairs) {
      await client.query(
        'DELETE FROM quiz_matching_pairs WHERE question_id = $1',
        [data.questionId]
      );

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
            data.questionId,
            pair.left_text,
            pair.right_text,
            pair.position || i + 1,
          ]
        );
      }
    }

    const fullQuestion = await getFullQuestion(client, data.questionId);

    await client.query('COMMIT');

    return fullQuestion;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}