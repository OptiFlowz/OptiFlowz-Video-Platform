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
    questionId: z.string().uuid('Invalid question ID'),
    question_text: z.string().trim().min(1).optional(),
    explanation: z.string().trim().max(5000).optional().nullable(),
    points: z.coerce.number().int().min(1).max(100).optional(),
    position: z.coerce.number().int().min(1).optional().nullable(),
    is_active: z.boolean().optional(),
    options: z.array(optionSchema).optional(),
    pairs: z.array(pairSchema).optional(),
    video_id: z.string().uuid('Invalid video ID').optional().nullable(),
    playlist_id: z.string().uuid('Invalid playlist ID').optional().nullable(),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse(object));
}

function hasField(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
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

export async function updateQuizQuestionInternal(object, userId = null) {  
  const data = prerequisites(object, userId);

  const result = await writePool.query(
    `SELECT quiz_id FROM quiz_questions WHERE id = $1`,
    [data.questionId]
  );

  if (result.rows.length === 0 || !result.rows[0].quiz_id) {
    throw new Error("Quiz ID not found for this question");
  }
  const { quiz_id } = result.rows[0];
  data.quizId=quiz_id;

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
          video_id = $8,
          playlist_id = CASE WHEN $9 THEN $10 ELSE playlist_id END
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
        data.video_id ?? null,
        hasField(data, 'playlist_id'),
        data.playlist_id ?? null
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
