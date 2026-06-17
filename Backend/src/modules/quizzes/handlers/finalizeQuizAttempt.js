import { gradeQuizAnswer } from './gradeQuizAnswer.js';

async function getAttempt(client, attemptId, userId = null) {
  const params = userId ? [attemptId, userId] : [attemptId];
  const { rows } = await client.query(
    `
      SELECT
        qa.*,
        q.passing_score_percentage
      FROM quiz_attempts qa
      JOIN quizzes q
        ON q.id = qa.quiz_id
      WHERE qa.id = $1
        ${userId ? 'AND qa.user_id = $2' : ''}
      FOR UPDATE OF qa;
    `,
    params
  );

  return rows[0] || null;
}

async function getAttemptQuestions(client, attemptId) {
  const { rows } = await client.query(
    `
      SELECT
        qaq.id AS attempt_question_id,
        qaq.question_id,
        qaq.answer,
        qaq.result,
        qaq.awarded_points,
        qq.question_type,
        qq.explanation,
        qq.points
      FROM quiz_attempt_questions qaq
      JOIN quiz_questions qq
        ON qq.id = qaq.question_id
      WHERE qaq.attempt_id = $1
      ORDER BY qaq.position ASC
      FOR UPDATE OF qaq;
    `,
    [attemptId]
  );

  return rows;
}

async function getQuestionReviewData(client, questionIds) {
  const optionsResult = await client.query(
    `
      SELECT id, question_id, is_correct
      FROM quiz_question_options
      WHERE question_id = ANY($1::uuid[]);
    `,
    [questionIds]
  );

  const pairsResult = await client.query(
    `
      SELECT id, question_id
      FROM quiz_matching_pairs
      WHERE question_id = ANY($1::uuid[]);
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

export async function finalizeQuizAttempt(client, attemptId, userId = null) {
  const attempt = await getAttempt(client, attemptId, userId);

  if (!attempt) {
    return null;
  }

  if (attempt.status === 'submitted') {
    return attempt;
  }

  const attemptQuestions = await getAttemptQuestions(client, attemptId);
  const questionIds = attemptQuestions.map((question) => question.question_id);
  const { optionsByQuestionId, pairsByQuestionId } = await getQuestionReviewData(client, questionIds);

  for (const question of attemptQuestions) {
    const review =
      question.result != null && question.awarded_points != null
        ? {
            result: question.result,
            awarded_points: Number(question.awarded_points),
          }
        : gradeQuizAnswer({
            question,
            answer: question.answer?.response,
            options: optionsByQuestionId[question.question_id] || [],
            pairs: pairsByQuestionId[question.question_id] || [],
            scoring: attempt.scoring,
          });

    await client.query(
      `
        UPDATE quiz_attempt_questions
        SET
          result = $2,
          awarded_points = $3
        WHERE id = $1;
      `,
      [question.attempt_question_id, review.result, review.awarded_points]
    );
  }

  const { rows } = await client.query(
    `
      WITH scores AS (
        SELECT
          COALESCE(SUM(qaq.awarded_points), 0)::numeric AS score_points,
          COALESCE(SUM(qq.points), 0)::numeric AS max_points
        FROM quiz_attempt_questions qaq
        JOIN quiz_questions qq
          ON qq.id = qaq.question_id
        WHERE qaq.attempt_id = $1
      )
      UPDATE quiz_attempts qa
      SET
        status = 'submitted',
        submitted_at = COALESCE(qa.submitted_at, now()),
        score_points = scores.score_points,
        max_points = scores.max_points,
        score_percentage = CASE
          WHEN scores.max_points > 0 THEN ROUND((scores.score_points / scores.max_points) * 100, 2)
          ELSE 0
        END,
        passed = CASE
          WHEN scores.max_points > 0 THEN
            ROUND((scores.score_points / scores.max_points) * 100, 2) >= $2
          ELSE false
        END
      FROM scores
      WHERE qa.id = $1
      RETURNING qa.*;
    `,
    [attemptId, attempt.passing_score_percentage]
  );

  return rows[0] || null;
}
