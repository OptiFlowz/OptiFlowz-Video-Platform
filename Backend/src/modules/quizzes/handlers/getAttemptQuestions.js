import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { gradeQuizAnswer } from './gradeQuizAnswer.js';
import { finalizeQuizAttempt } from './finalizeQuizAttempt.js';

function prerequisites(object, userId) {
  const schema = z.object({
    attemptId: z.string().uuid('Invalid attempt ID'),
    userId: z.string().uuid('Invalid user ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

function getSelectedOptionIds(answer) {
  const response = answer?.response;

  if (Array.isArray(response)) {
    return response.map(String);
  }

  if (Array.isArray(response?.option_ids)) {
    return response.option_ids.map(String);
  }

  if (response?.option_id) {
    return [String(response.option_id)];
  }

  return [];
}

function getSelectedPairs(answer) {
  return Array.isArray(answer?.response?.pairs) ? answer.response.pairs : [];
}

function orderByIds(items, orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return items;
  }

  const order = new Map(orderedIds.map((id, index) => [String(id), index]));

  return [...items].sort((a, b) => {
    const aIndex = order.has(String(a.id)) ? order.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
    const bIndex = order.has(String(b.id)) ? order.get(String(b.id)) : Number.MAX_SAFE_INTEGER;

    return aIndex - bIndex;
  });
}

function shouldRevealReview(attempt, attemptQuestion) {
  if (attempt.answer_review_mode === 'immediate' || attempt.answer_review_mode === 'assignment') {
    return attemptQuestion.result != null;
  }

  return attempt.answer_review_mode === 'at_end' && attempt.status === 'submitted';
}

function shouldHideCorrectFeedback(attempt, attemptQuestion) {
  return (
    attempt.answer_review_mode === 'assignment' &&
    attemptQuestion.result != null &&
    attemptQuestion.result !== 'correct'
  );
}

function normalizeAssignmentReview(review) {
  if (review.result === 'correct') {
    return review;
  }

  return {
    result: 'incorrect',
    max_points: review.max_points,
    explanation: review.explanation || null,
  };
}

function buildChoiceQuestion(attempt, attemptQuestion, options) {
  const revealReview = shouldRevealReview(attempt, attemptQuestion);
  const hideCorrectFeedback = shouldHideCorrectFeedback(attempt, attemptQuestion);
  const selectedOptionIds = new Set(getSelectedOptionIds(attemptQuestion.answer));
  const orderedOptions = orderByIds(options, attemptQuestion.answer?.option_order);

  const response = {
    ...attemptQuestion,
    selected_option_ids: [...selectedOptionIds],
    options: orderedOptions.map((option) => {
      const mapped = {
        id: option.id,
        option_text: option.option_text,
        position: option.position,
        selected: selectedOptionIds.has(String(option.id)),
      };

      if (revealReview && !hideCorrectFeedback) {
        mapped.is_correct = option.is_correct;
      }

      return mapped;
    }),
  };

  if (revealReview) {
    const review =
      attemptQuestion.result != null
        ? {
            result: attemptQuestion.result,
            awarded_points: attemptQuestion.awarded_points,
            max_points: attemptQuestion.points,
            correct_option_ids: options
              .filter((option) => option.is_correct)
              .map((option) => option.id),
            selected_option_ids: [...selectedOptionIds],
            explanation: attemptQuestion.explanation || null,
          }
        : gradeQuizAnswer({
            question: attemptQuestion,
            answer: attemptQuestion.answer?.response,
            options,
            scoring: attempt.scoring,
          });

    response.review = hideCorrectFeedback ? normalizeAssignmentReview(review) : review;
  }

  return response;
}

function buildMatchingQuestion(attempt, attemptQuestion, pairs) {
  const revealReview = shouldRevealReview(attempt, attemptQuestion);
  const hideCorrectFeedback = shouldHideCorrectFeedback(attempt, attemptQuestion);
  const selectedPairs = getSelectedPairs(attemptQuestion.answer);
  const rightItems = orderByIds(pairs, attemptQuestion.answer?.pair_order);

  const response = {
    ...attemptQuestion,
    selected_pairs: selectedPairs,
    left_items: pairs.map((pair) => ({
      id: pair.id,
      left_text: pair.left_text,
      position: pair.position,
    })),
    right_items: rightItems.map((pair) => ({
      id: pair.id,
      right_text: pair.right_text,
      position: pair.position,
    })),
  };

  if (revealReview && !hideCorrectFeedback) {
    response.pairs = pairs.map((pair) => ({
      id: pair.id,
      left_text: pair.left_text,
      right_text: pair.right_text,
      position: pair.position,
    }));

    response.review =
      attemptQuestion.result != null
        ? {
            result: attemptQuestion.result,
            awarded_points: attemptQuestion.awarded_points,
            max_points: attemptQuestion.points,
            correct_pairs: pairs.map((pair) => ({
              left_pair_id: pair.id,
              right_pair_id: pair.id,
            })),
            explanation: attemptQuestion.explanation || null,
          }
        : gradeQuizAnswer({
            question: attemptQuestion,
            answer: attemptQuestion.answer?.response,
            pairs,
            scoring: attempt.scoring,
          });
  } else if (revealReview) {
    response.review = normalizeAssignmentReview({
      result: attemptQuestion.result,
      max_points: attemptQuestion.points,
      explanation: attemptQuestion.explanation || null,
    });
  }

  return response;
}

function stripInternalFields(question) {
  const {
    answer,
    result,
    awarded_points,
    explanation,
    ...visibleQuestion
  } = question;

  return visibleQuestion;
}

export async function getAttemptQuestionsInternal(object, userId = null) {
  const { attemptId, userId: validatedUserId } = prerequisites(object, userId);
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const attemptResult = await client.query(
      `
        SELECT
          id,
          quiz_id,
          user_id,
          attempt_number,
          status,
          started_at,
          submitted_at,
          expires_at,
          score_points,
          max_points,
          score_percentage,
          passed,
          answer_review_mode,
          scoring
        FROM quiz_attempts
        WHERE id = $1
          AND user_id = $2
        FOR UPDATE;
      `,
      [attemptId, validatedUserId]
    );

    let attempt = attemptResult.rows[0] || null;

    if (!attempt) {
      const error = new Error('Quiz attempt not found');
      error.status = 404;
      throw error;
    }

    if (
      attempt.status === 'in_progress' &&
      attempt.expires_at &&
      new Date(attempt.expires_at).getTime() <= Date.now()
    ) {
      attempt = await finalizeQuizAttempt(client, attemptId, validatedUserId);
    }

    const questionsResult = await client.query(
      `
        SELECT
          qaq.id AS attempt_question_id,
          qaq.attempt_id,
          qaq.question_id,
          qaq.position AS attempt_position,
          qaq.answer,
          qaq.result,
          qaq.awarded_points,
          qq.question_text,
          qq.question_type,
          qq.explanation,
          qq.points,
          qq.video_id,
          qq.playlist_id
        FROM quiz_attempt_questions qaq
        JOIN quiz_questions qq
          ON qq.id = qaq.question_id
        WHERE qaq.attempt_id = $1
        ORDER BY qaq.position ASC;
      `,
      [attemptId]
    );

    const questions = questionsResult.rows;
    const questionIds = questions.map((question) => question.question_id);

    const optionsResult = await client.query(
      `
        SELECT id, question_id, option_text, is_correct, position
        FROM quiz_question_options
        WHERE question_id = ANY($1::uuid[])
        ORDER BY position ASC, id ASC;
      `,
      [questionIds]
    );

    const pairsResult = await client.query(
      `
        SELECT id, question_id, left_text, right_text, position
        FROM quiz_matching_pairs
        WHERE question_id = ANY($1::uuid[])
        ORDER BY position ASC, id ASC;
      `,
      [questionIds]
    );

    const optionsByQuestionId = optionsResult.rows.reduce((acc, option) => {
      if (!acc[option.question_id]) {
        acc[option.question_id] = [];
      }

      acc[option.question_id].push(option);
      return acc;
    }, {});

    const pairsByQuestionId = pairsResult.rows.reduce((acc, pair) => {
      if (!acc[pair.question_id]) {
        acc[pair.question_id] = [];
      }

      acc[pair.question_id].push(pair);
      return acc;
    }, {});

    await client.query('COMMIT');

    return {
      attempt,
      questions: questions.map((question) => {
        const questionWithData =
          question.question_type === 'matching'
            ? buildMatchingQuestion(attempt, question, pairsByQuestionId[question.question_id] || [])
            : buildChoiceQuestion(attempt, question, optionsByQuestionId[question.question_id] || []);

        return stripInternalFields(questionWithData);
      }),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
