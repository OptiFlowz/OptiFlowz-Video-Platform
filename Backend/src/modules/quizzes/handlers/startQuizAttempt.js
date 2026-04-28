import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { sanitizeQuestionForUser, buildAttemptResponse } from '../services/quizAttempt.service.js';

async function prerequisites(object, userId, client) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quizId ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const { quizId } = validateOrThrow(schema.safeParse(object));

  const quizResult = await client.query(
    `
      SELECT *
      FROM video_quizzes
      WHERE id = $1
        AND is_active = true
      LIMIT 1
    `,
    [quizId]
  );

  const quiz = quizResult.rows[0];

  if (!quiz) {
    const error = new Error('Quiz not found');
    error.status = 404;
    throw error;
  }

  const attemptsResult = await client.query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_total
      FROM quiz_attempts
      WHERE quiz_id = $1
        AND user_id = $2
    `,
    [quiz.id, userId]
  );

  const attemptsTotal = attemptsResult.rows[0]?.total || 0;
  const inProgressTotal = attemptsResult.rows[0]?.in_progress_total || 0;

  if (inProgressTotal > 0) {
    const error = new Error('You already have an attempt in progress for this quiz');
    error.status = 409;
    throw error;
  }

  if (quiz.max_attempts !== null && attemptsTotal >= quiz.max_attempts) {
    const error = new Error('Maximum number of attempts reached');
    error.status = 403;
    throw error;
  }

  return {
    quiz,
    attemptsTotal,
  };
}

async function loadAttemptQuestions(client, attemptId, shuffleOptions) {
  const { rows } = await client.query(
    `
      SELECT
        q.*,
        aq.position AS attempt_position,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', o.id,
              'option_text', o.option_text,
              'position', o.position
            )
          ) FILTER (WHERE o.id IS NOT NULL),
          '[]'::json
        ) AS options,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', mp.id,
              'left_text', mp.left_text,
              'right_text', mp.right_text,
              'position', mp.position
            )
          ) FILTER (WHERE mp.id IS NOT NULL),
          '[]'::json
        ) AS pairs
      FROM quiz_attempt_questions aq
      JOIN quiz_questions q ON q.id = aq.question_id
      LEFT JOIN quiz_question_options o ON o.question_id = q.id
      LEFT JOIN quiz_matching_pairs mp ON mp.question_id = q.id
      WHERE aq.attempt_id = $1
      GROUP BY q.id, aq.position
      ORDER BY aq.position ASC
    `,
    [attemptId]
  );

  return rows.map((question) => sanitizeQuestionForUser(question, { shuffleOptions }));
}

export async function startQuizAttemptInternal(object, userId = null) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');

    const { quiz, attemptsTotal } = await prerequisites(object, userId, client);

    const selectedQuestionsResult = await client.query(
      `
        SELECT id, points
        FROM quiz_questions
        WHERE quiz_id = $1
          AND is_active = true
        ORDER BY ${quiz.shuffle_questions ? 'RANDOM()' : 'position ASC NULLS LAST, created_at ASC'}
        LIMIT $2
      `,
      [quiz.id, quiz.question_count]
    );

    if (selectedQuestionsResult.rows.length === 0) {
      const error = new Error('Quiz has no active questions');
      error.status = 400;
      throw error;
    }

    const attemptResult = await client.query(
      `
        INSERT INTO quiz_attempts (
          quiz_id,
          user_id,
          attempt_number,
          status,
          expires_at
        )
        VALUES ($1,$2,$3,'in_progress',CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() + ($4::int * INTERVAL '1 second') END)
        RETURNING *
      `,
      [quiz.id, userId, attemptsTotal + 1, quiz.time_limit_seconds]
    );

    const attempt = attemptResult.rows[0];

    for (let i = 0; i < selectedQuestionsResult.rows.length; i += 1) {
      const question = selectedQuestionsResult.rows[i];
      await client.query(
        `
          INSERT INTO quiz_attempt_questions (attempt_id, question_id, position)
          VALUES ($1,$2,$3)
        `,
        [attempt.id, question.id, i + 1]
      );
    }

    const questions = await loadAttemptQuestions(client, attempt.id, quiz.shuffle_options);

    await client.query('COMMIT');
    return buildAttemptResponse(attempt, questions);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
