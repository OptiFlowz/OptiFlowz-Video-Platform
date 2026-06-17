import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { gradeQuizAnswer } from './gradeQuizAnswer.js';
import { finalizeQuizAttempt } from './finalizeQuizAttempt.js';

function prerequisites(object, userId) {
  const schema = z.object({
    attemptId: z.string().uuid('Invalid attempt ID'),
    questionId: z.string().uuid('Invalid question ID'),
    userId: z.string().uuid('Invalid user ID'),
    answer: z.any().refine((value) => value !== undefined, 'Answer is required'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

function mergeAnswer(existingAnswer, submittedAnswer) {
  if (existingAnswer && typeof existingAnswer === 'object' && !Array.isArray(existingAnswer)) {
    return {
      ...existingAnswer,
      response: submittedAnswer,
      answered_at: new Date().toISOString(),
    };
  }

  return {
    response: submittedAnswer,
    answered_at: new Date().toISOString(),
  };
}

async function getAttemptQuestion(client, attemptId, questionId, userId) {
  const { rows } = await client.query(
    `
      SELECT
        qaq.id AS attempt_question_id,
        qaq.answer AS existing_answer,
        qaq.result AS existing_result,
        qaq.awarded_points AS existing_awarded_points,
        qa.id AS attempt_id,
        qa.user_id,
        qa.status,
        qa.expires_at,
        qa.answer_review_mode,
        qa.scoring,
        qq.id AS question_id,
        qq.question_type,
        qq.explanation,
        qq.points
      FROM quiz_attempt_questions qaq
      JOIN quiz_attempts qa
        ON qa.id = qaq.attempt_id
      JOIN quiz_questions qq
        ON qq.id = qaq.question_id
      WHERE qaq.attempt_id = $1
        AND qaq.question_id = $2
        AND qa.user_id = $3
      FOR UPDATE OF qaq, qa;
    `,
    [attemptId, questionId, userId]
  );

  return rows[0] || null;
}

async function getQuestionReviewData(client, questionId) {
  const optionsResult = await client.query(
    `
      SELECT id, is_correct
      FROM quiz_question_options
      WHERE question_id = $1;
    `,
    [questionId]
  );

  const pairsResult = await client.query(
    `
      SELECT id
      FROM quiz_matching_pairs
      WHERE question_id = $1;
    `,
    [questionId]
  );

  return {
    options: optionsResult.rows,
    pairs: pairsResult.rows,
  };
}

async function updateAttemptScore(client, attemptId) {
  const { rows } = await client.query(
    `
      UPDATE quiz_attempts qa
      SET
        score_points = scores.score_points,
        score_percentage = CASE
          WHEN qa.max_points > 0 THEN ROUND((scores.score_points / qa.max_points) * 100, 2)
          ELSE 0
        END
      FROM (
        SELECT COALESCE(SUM(awarded_points), 0)::numeric AS score_points
        FROM quiz_attempt_questions
        WHERE attempt_id = $1
      ) scores
      WHERE qa.id = $1
      RETURNING qa.score_points, qa.score_percentage;
    `,
    [attemptId]
  );

  return rows[0] || null;
}

function normalizeAssignmentReview(review) {
  if (review.result === 'correct') {
    return {
      ...review,
      points: review.max_points,
    };
  }

  return {
    result: 'incorrect',
    points: review.max_points,
    max_points: review.max_points,
    explanation: review.explanation || null,
  };
}

function assertAttemptCanReceiveAnswer(attemptQuestion) {
  if (!attemptQuestion) {
    const error = new Error('Attempt question not found');
    error.status = 404;
    throw error;
  }

  if (attemptQuestion.status !== 'in_progress') {
    const error = new Error('Quiz attempt is not in progress.');
    error.status = 409;
    throw error;
  }

  if (attemptQuestion.answer_review_mode === 'immediate' && attemptQuestion.existing_result != null) {
    const error = new Error('Answer has already been submitted and reviewed.');
    error.status = 409;
    throw error;
  }

  if (attemptQuestion.answer_review_mode === 'assignment' && attemptQuestion.existing_result === 'correct') {
    const error = new Error('Answer has already been submitted and reviewed.');
    error.status = 409;
    throw error;
  }
}

export async function saveAttemptAnswerInternal(object, userId = null) {
  const { attemptId, questionId, userId: validatedUserId, answer } = prerequisites(object, userId);
  const client = await writePool.connect();
  let transactionFinished = false;

  try {
    await client.query('BEGIN');

    const attemptQuestion = await getAttemptQuestion(client, attemptId, questionId, validatedUserId);
    assertAttemptCanReceiveAnswer(attemptQuestion);

    if (attemptQuestion.expires_at && new Date(attemptQuestion.expires_at).getTime() <= Date.now()) {
      const attempt = await finalizeQuizAttempt(client, attemptId, validatedUserId);

      await client.query('COMMIT');
      transactionFinished = true;

      return {
        saved: false,
        submitted: true,
        attempt,
      };
    }

    const storedAnswer = mergeAnswer(attemptQuestion.existing_answer, answer);

    if (attemptQuestion.answer_review_mode === 'at_end') {
      await client.query(
        `
          UPDATE quiz_attempt_questions
          SET answer = $2::jsonb
          WHERE id = $1;
        `,
        [attemptQuestion.attempt_question_id, JSON.stringify(storedAnswer)]
      );

      await client.query('COMMIT');
      transactionFinished = true;

      return { saved: true };
    }

    const { options, pairs } = await getQuestionReviewData(client, questionId);
    const review = gradeQuizAnswer({
      question: attemptQuestion,
      answer,
      options,
      pairs,
      scoring: attemptQuestion.scoring,
    });
    const storedResult =
      attemptQuestion.answer_review_mode === 'assignment' && review.result !== 'correct'
        ? 'incorrect'
        : review.result;

    await client.query(
      `
        UPDATE quiz_attempt_questions
        SET
          answer = $2::jsonb,
          result = $3,
          awarded_points = $4
        WHERE id = $1;
      `,
      [
        attemptQuestion.attempt_question_id,
        JSON.stringify(storedAnswer),
        storedResult,
        review.awarded_points,
      ]
    );

    const score = await updateAttemptScore(client, attemptId);

    await client.query('COMMIT');
    transactionFinished = true;

    return {
      saved: true,
      review:
        attemptQuestion.answer_review_mode === 'assignment'
          ? normalizeAssignmentReview(review)
          : review,
      score,
    };
  } catch (error) {
    if (!transactionFinished) {
      await client.query('ROLLBACK');
    }

    throw error;
  } finally {
    client.release();
  }
}
