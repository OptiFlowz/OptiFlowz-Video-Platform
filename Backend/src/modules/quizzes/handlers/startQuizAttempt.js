import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { checkQuizRequirementsInternal } from './checkQuizRequirements.js';
import { finalizeQuizAttempt } from './finalizeQuizAttempt.js';

function prerequisites(object, userId) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quiz ID'),
    userId: z.string().uuid('Invalid user ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

function shuffle(items) {
  const shuffled = [...items];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

function allocateSourceCounts(sources, questionCount) {
  const desiredQuestionCount = Math.min(
    questionCount,
    Math.round(
      sources.reduce((sum, source) => sum + (questionCount * Number(source.percentage || 0)) / 100, 0)
    )
  );

  const allocations = sources.map((source) => {
    const exactCount = (questionCount * Number(source.percentage || 0)) / 100;

    return {
      ...source,
      questionCount: Math.floor(exactCount),
      remainder: exactCount % 1,
    };
  });

  let remaining =
    desiredQuestionCount - allocations.reduce((sum, source) => sum + source.questionCount, 0);

  for (const source of [...allocations].sort((a, b) => b.remainder - a.remainder)) {
    if (remaining <= 0) {
      break;
    }

    source.questionCount += 1;
    remaining -= 1;
  }

  const allocationsBySmallestRemainder = [...allocations].sort((a, b) => a.remainder - b.remainder);

  while (remaining < 0) {
    const source = allocationsBySmallestRemainder.find((allocation) => allocation.questionCount > 0);

    if (!source) {
      break;
    }

    source.questionCount -= 1;
    remaining += 1;
  }

  return allocations.filter((source) => source.questionCount > 0);
}

function buildAttemptQuestionAnswer(question, optionsByQuestionId, pairsByQuestionId, shuffleOptions) {
  if (question.question_type === 'single_choice' || question.question_type === 'multiple_choice') {
    const options = optionsByQuestionId[question.id] || [];
    const orderedOptions = shuffleOptions ? shuffle(options) : options;

    return {
      response: null,
      option_order: orderedOptions.map((option) => option.id),
    };
  }

  if (question.question_type === 'matching') {
    const pairs = pairsByQuestionId[question.id] || [];
    const orderedPairs = shuffleOptions ? shuffle(pairs) : pairs;

    return {
      response: null,
      pair_order: orderedPairs.map((pair) => pair.id),
    };
  }

  return null;
}

async function getQuiz(client, quizId) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        time_limit_seconds,
        question_count,
        max_attempts,
        shuffle_questions,
        shuffle_options,
        answer_review_mode,
        scoring
      FROM quizzes
      WHERE id = $1
        AND is_active = true
      LIMIT 1;
    `,
    [quizId]
  );

  return rows[0] || null;
}

async function getQuestionSources(client, quizId) {
  const { rows } = await client.query(
    `
      SELECT id, source_type, playlist_id, percentage
      FROM quiz_question_sources
      WHERE quiz_id = $1
      ORDER BY id;
    `,
    [quizId]
  );

  return rows;
}

async function getQuestionsForQuiz(client, quizId, shuffleQuestions, limit) {
  const { rows } = await client.query(
    `
      SELECT id, question_type, points
      FROM quiz_questions
      WHERE quiz_id = $1
        AND is_active = true
      ORDER BY ${shuffleQuestions ? 'random()' : 'COALESCE(position, 2147483647), id'}
      LIMIT $2;
    `,
    [quizId, limit]
  );

  return rows;
}

async function getQuestionsForSources(client, quizId, sources, shuffleQuestions) {
  const selectedQuestions = [];
  const selectedQuestionIds = new Set();

  for (const source of sources) {
    const { rows } = await client.query(
      `
        SELECT id, question_type, points
        FROM quiz_questions
        WHERE quiz_id = $1
          AND playlist_id = $2
          AND is_active = true
          AND NOT (id = ANY($4::uuid[]))
        ORDER BY ${shuffleQuestions ? 'random()' : 'COALESCE(position, 2147483647), id'}
        LIMIT $3;
      `,
      [quizId, source.playlist_id, source.questionCount, [...selectedQuestionIds]]
    );

    for (const question of rows) {
      selectedQuestionIds.add(question.id);
      selectedQuestions.push(question);
    }
  }

  return shuffleQuestions ? shuffle(selectedQuestions) : selectedQuestions;
}

async function getQuestionOptions(client, questionIds) {
  if (questionIds.length === 0) {
    return { optionsByQuestionId: {}, pairsByQuestionId: {} };
  }

  const optionsResult = await client.query(
    `
      SELECT id, question_id
      FROM quiz_question_options
      WHERE question_id = ANY($1::uuid[])
      ORDER BY position ASC, id ASC;
    `,
    [questionIds]
  );

  const pairsResult = await client.query(
    `
      SELECT id, question_id
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

  return { optionsByQuestionId, pairsByQuestionId };
}

export async function startQuizAttemptInternal(object, userId = null) {
  const { quizId, userId: validatedUserId } = prerequisites(object, userId);
  const hasMetRequirements = await checkQuizRequirementsInternal({ quizId }, validatedUserId);

  if (!hasMetRequirements) {
    const error = new Error('Quiz requirements have not been met.');
    error.status = 403;
    throw error;
  }

  const client = await writePool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text));', [
      quizId,
      validatedUserId,
    ]);

    const quiz = await getQuiz(client, quizId);

    if (!quiz) {
      const error = new Error('Quiz not found');
      error.status = 404;
      throw error;
    }

    const timedOutAttemptsResult = await client.query(
      `
        SELECT id
        FROM quiz_attempts
        WHERE quiz_id = $1
          AND user_id = $2
          AND status = 'in_progress'
          AND expires_at IS NOT NULL
          AND expires_at <= now()
        FOR UPDATE;
      `,
      [quizId, validatedUserId]
    );

    for (const attempt of timedOutAttemptsResult.rows) {
      await finalizeQuizAttempt(client, attempt.id, validatedUserId);
    }

    const attemptsResult = await client.query(
      `
        SELECT
          COUNT(*)::int AS attempt_count,
          COALESCE(MAX(attempt_number), 0)::int AS last_attempt_number,
          COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_count
        FROM quiz_attempts
        WHERE quiz_id = $1
          AND user_id = $2;
      `,
      [quizId, validatedUserId]
    );

    const attemptCount = attemptsResult.rows[0]?.attempt_count || 0;
    const inProgressCount = attemptsResult.rows[0]?.in_progress_count || 0;

    if (inProgressCount > 0) {
      const error = new Error('User already has a quiz attempt in progress.');
      error.status = 409;
      throw error;
    }

    if (quiz.max_attempts != null && attemptCount >= quiz.max_attempts) {
      const error = new Error('Maximum quiz attempts reached.');
      error.status = 403;
      throw error;
    }

    const sources = await getQuestionSources(client, quizId);
    const unsupportedSource = sources.find(
      (source) =>
        source.source_type !== 'playlist' ||
        source.playlist_id == null ||
        source.percentage == null
    );

    if (unsupportedSource) {
      const error = new Error('Only playlist percentage question sources are supported.');
      error.status = 400;
      throw error;
    }

    const questions =
      sources.length > 0
        ? await getQuestionsForSources(
            client,
            quizId,
            allocateSourceCounts(sources, quiz.question_count),
            quiz.shuffle_questions
          )
        : await getQuestionsForQuiz(client, quizId, quiz.shuffle_questions, quiz.question_count);

    if (questions.length < quiz.question_count) {
      const error = new Error('Quiz does not have enough available questions.');
      error.status = 400;
      throw error;
    }

    const questionIds = questions.map((question) => question.id);
    const { optionsByQuestionId, pairsByQuestionId } = await getQuestionOptions(client, questionIds);
    const maxPoints = questions.reduce((sum, question) => sum + Number(question.points || 0), 0);
    const attemptNumber = (attemptsResult.rows[0]?.last_attempt_number || 0) + 1;

    const attemptResult = await client.query(
      `
        INSERT INTO quiz_attempts (
          quiz_id,
          user_id,
          attempt_number,
          expires_at,
          max_points,
          answer_review_mode,
          scoring
        )
        VALUES (
          $1,
          $2,
          $3,
          CASE
            WHEN $4::int IS NULL OR $4::int <= 0 THEN NULL
            ELSE now() + ($4::int * interval '1 second')
          END,
          $5,
          $6,
          $7
        )
        RETURNING *;
      `,
      [
        quizId,
        validatedUserId,
        attemptNumber,
        quiz.time_limit_seconds,
        maxPoints,
        quiz.answer_review_mode || 'immediate',
        quiz.scoring || 'partial',
      ]
    );

    const attempt = attemptResult.rows[0];
    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i];
      const answer = buildAttemptQuestionAnswer(
        question,
        optionsByQuestionId,
        pairsByQuestionId,
        quiz.shuffle_options
      );

      await client.query(
        `
          INSERT INTO quiz_attempt_questions (
            attempt_id,
            question_id,
            position,
            answer
          )
          VALUES ($1, $2, $3, $4::jsonb)
        `,
        [attempt.id, question.id, i + 1, JSON.stringify(answer)]
      );
    }

    await client.query('COMMIT');

    return attempt;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
