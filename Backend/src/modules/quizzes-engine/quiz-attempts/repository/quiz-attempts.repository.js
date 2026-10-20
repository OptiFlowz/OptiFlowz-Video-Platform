// Shared projection keeps submit and list responses, including score visibility, identical.
const ATTEMPT_RESPONSE_FIELDS = `
  a.id, a.quiz_id, a.attempt_no, a.status, a.started_at, a.expires_at, a.finished_at,
  a.max_points::double precision AS max_points, a.settings_snapshot AS settings,
  CASE WHEN a.status IN ('submitted', 'timed_out') AND a.settings_snapshot->>'show_final_score' = 'true'
    THEN a.earned_points::double precision END AS earned_points,
  CASE WHEN a.status IN ('submitted', 'timed_out') AND a.settings_snapshot->>'show_final_score' = 'true'
    THEN a.score_percentage::double precision END AS score_percentage,
  CASE WHEN a.status IN ('submitted', 'timed_out') AND a.settings_snapshot->>'show_final_score' = 'true'
    THEN a.passed END AS passed`;

export async function getAttemptSubmissionSummary(database, attemptId, settings) {
  const { rows } = await database.query(`
    WITH totals AS (
      SELECT count(*)::integer AS total_questions,
        count(*) FILTER (WHERE ans.checked_at IS NOT NULL)::integer AS answered_questions,
        count(*) FILTER (WHERE ans.checked_at IS NOT NULL AND ans.is_correct=true)::integer AS correct_questions,
        COALESCE(sum(ans.awarded_points) FILTER (WHERE ans.checked_at IS NOT NULL), 0) AS earned_points,
        COALESCE(sum(q.max_points), 0) AS max_points,
        COALESCE(bool_or(q.max_points <= 0 OR (ans.checked_at IS NOT NULL AND (
          ans.is_correct IS NULL OR ans.awarded_points IS NULL OR ans.awarded_points < 0 OR ans.awarded_points > q.max_points
        ))), false) AS invalid_grading
      FROM public.quiz_attempt_questions q
      LEFT JOIN public.quiz_attempt_answers ans ON ans.attempt_id=q.attempt_id AND ans.question_no=q.question_no
      WHERE q.attempt_id=$1
    ), scored AS (
      SELECT *, round(earned_points / NULLIF(max_points, 0) * 100, 2) AS score_percentage,
        answered_questions::numeric * 100 >= total_questions::numeric * $2::numeric AS answered_requirement_met,
        correct_questions::numeric * 100 >= total_questions::numeric * $3::numeric AS correct_requirement_met
      FROM totals
    )
    SELECT *, score_percentage >= $4::numeric AS passed FROM scored
  `, [attemptId, settings.min_answered_percentage, settings.min_correct_percentage, settings.passing_score_percentage]);
  return rows[0];
}

export async function submitAttempt(database, attemptId, summary) {
  const { rows } = await database.query(`
    WITH finished AS (SELECT clock_timestamp() AS at)
    UPDATE public.quiz_attempts a SET status='submitted', finished_at=finished.at,
      earned_points=$2, max_points=$3, score_percentage=$4, passed=$5
    FROM finished
    WHERE a.id=$1 AND a.status='in_progress' AND (a.expires_at IS NULL OR a.expires_at > finished.at)
    RETURNING ${ATTEMPT_RESPONSE_FIELDS}
  `, [attemptId, summary.earned_points, summary.max_points, summary.score_percentage, summary.passed]);
  return rows[0] || null;
}

export async function getOwnedAttemptWithQuestions(database, attemptId, userId) {
  // One statement gives the attempt, snapshots and answers a consistent read;
  // use the primary pool so a reload sees the participant's latest saved answer.
  const { rows } = await database.query(`
    SELECT a.id, a.status, a.expires_at, a.settings_snapshot,
      a.expires_at IS NOT NULL AND a.expires_at <= statement_timestamp() AS expired,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'question_no', q.question_no, 'question_id', q.question_id,
        'max_points', q.max_points, 'question_snapshot', q.question_snapshot,
        'saved_answer', CASE WHEN ans.attempt_id IS NULL THEN NULL ELSE to_jsonb(ans) END
      ) ORDER BY q.question_no)
        FROM public.quiz_attempt_questions q
        LEFT JOIN public.quiz_attempt_answers ans
          ON ans.attempt_id=q.attempt_id AND ans.question_no=q.question_no
        WHERE q.attempt_id=a.id), '[]'::jsonb) AS questions
    FROM public.quiz_attempts a WHERE a.id=$1 AND a.user_id=$2
  `, [attemptId, userId]);
  return rows[0] || null;
}

export async function lockOwnedAttempt(database, attemptId, userId) {
  const { rows } = await database.query('SELECT * FROM public.quiz_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE', [attemptId, userId]);
  return rows[0] || null;
}

export async function isAttemptExpired(database, attemptId) {
  const { rows } = await database.query('SELECT expires_at IS NOT NULL AND expires_at <= clock_timestamp() AS expired FROM public.quiz_attempts WHERE id=$1', [attemptId]);
  return rows[0].expired;
}

export async function getAttemptQuestion(database, attemptId, questionNo) {
  const { rows } = await database.query('SELECT * FROM public.quiz_attempt_questions WHERE attempt_id=$1 AND question_no=$2', [attemptId, questionNo]);
  return rows[0] || null;
}

export async function getSavedAttemptAnswer(database, attemptId, questionNo) {
  const { rows } = await database.query('SELECT * FROM public.quiz_attempt_answers WHERE attempt_id=$1 AND question_no=$2', [attemptId, questionNo]);
  return rows[0] || null;
}

export async function upsertAttemptAnswer(database, attemptId, questionNo, answer, grade) {
  const { rows } = await database.query(`
    WITH checked AS (SELECT clock_timestamp() AS at)
    INSERT INTO public.quiz_attempt_answers (attempt_id, question_no, answer, checked_at, is_correct, awarded_points, updated_at)
    SELECT a.id, $2, $3::jsonb, checked.at, $4, $5, checked.at
    FROM public.quiz_attempts a CROSS JOIN checked
    WHERE a.id=$1 AND a.status='in_progress' AND (a.expires_at IS NULL OR a.expires_at > checked.at)
    ON CONFLICT (attempt_id, question_no) DO UPDATE SET
      answer=EXCLUDED.answer, checked_at=EXCLUDED.checked_at, is_correct=EXCLUDED.is_correct,
      awarded_points=EXCLUDED.awarded_points, updated_at=EXCLUDED.updated_at
    RETURNING *
  `, [attemptId, questionNo, JSON.stringify(answer), grade.is_correct, grade.awarded_points]);
  return rows[0] || null;
}

export async function listQuizAttempts(database, quizId, userId, { status, limit, offset, sortBy, sortOrder }) {
  const fields = { started_at: 'started_at', finished_at: 'finished_at', attempt_no: 'attempt_no', status: 'status' };
  const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
  const ordering = `${fields[sortBy]} ${direction} NULLS LAST, id ASC`;
  const { rows } = await database.query(`
    WITH visible_quiz AS (
      SELECT id FROM public.quizzes WHERE id = $1 AND (status = 'published' OR user_id = $2)
    ), owned_attempts AS (
      SELECT ${ATTEMPT_RESPONSE_FIELDS}
      FROM public.quiz_attempts a JOIN visible_quiz q ON q.id = a.quiz_id
      WHERE a.user_id = $2 AND ($3::public.quiz_attempt_status IS NULL OR a.status = $3)
    ), page AS (
      SELECT * FROM owned_attempts ORDER BY ${ordering} LIMIT $4 OFFSET $5
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS attempts,
      (SELECT count(*)::integer FROM owned_attempts) AS total
    FROM visible_quiz
  `, [quizId, userId, status ?? null, limit, offset]);
  return rows[0] || null;
}

export async function lockAttemptCreation(database, quizId, userId) {
  // Every start request for the same participant/quiz shares this transaction lock.
  await database.query("SELECT pg_advisory_xact_lock(hashtextextended('quiz-attempt:' || $1::text || ':' || $2::text, 0))", [quizId, userId]);
}

export async function lockQuizForAttempt(database, quizId) {
  const { rows } = await database.query('SELECT * FROM public.quizzes WHERE id=$1 FOR SHARE', [quizId]);
  return rows[0] || null;
}

export async function getActiveAttempt(database, quizId, userId) {
  const { rows } = await database.query(`
    SELECT *, expires_at IS NOT NULL AND expires_at <= clock_timestamp() AS expired
    FROM public.quiz_attempts WHERE quiz_id=$1 AND user_id=$2 AND status='in_progress' FOR UPDATE
  `, [quizId, userId]);
  return rows[0] || null;
}

export async function getAttemptHistory(database, quizId, userId) {
  const { rows } = await database.query(`SELECT count(*)::integer AS attempts_used,
    COALESCE(max(attempt_no), 0) AS last_attempt_no FROM public.quiz_attempts WHERE quiz_id=$1 AND user_id=$2`, [quizId, userId]);
  return rows[0];
}

export async function getAttemptQuestionPool(database, quizId) {
  const { rows } = await database.query(`
    SELECT q.id, q.user_id, qq.position, qq.max_points,
      COALESCE((SELECT jsonb_agg(gi.group_id ORDER BY gi.group_id)
        FROM public.question_group_items gi WHERE gi.question_id=q.id), '[]'::jsonb) AS group_ids,
      jsonb_build_object('type', q.type, 'content', q.content, 'explanation', q.explanation,
        'options', COALESCE((SELECT jsonb_agg(to_jsonb(o) - 'question_id' ORDER BY o.position, o.option_no)
          FROM public.question_options o WHERE o.question_id=q.id), '[]'::jsonb),
        'matching_options', COALESCE((SELECT jsonb_agg(to_jsonb(o) - 'question_id' ORDER BY o.position, o.option_no)
          FROM public.question_matching_options o WHERE o.question_id=q.id), '[]'::jsonb),
        'matching_items', COALESCE((SELECT jsonb_agg(to_jsonb(i) - 'question_id' ORDER BY i.position, i.item_no)
          FROM public.question_matching_items i WHERE i.question_id=q.id), '[]'::jsonb)
      ) AS question_snapshot
    FROM public.quiz_questions qq JOIN public.questions q ON q.id=qq.question_id
    WHERE qq.quiz_id=$1 ORDER BY q.id FOR SHARE OF q, qq
  `, [quizId]);
  return rows;
}

export async function getAttemptSources(database, quizId) {
  const { rows } = await database.query(`SELECT s.*, g.user_id FROM public.quiz_sources s
    JOIN public.question_groups g ON g.id=s.group_id WHERE s.quiz_id=$1 ORDER BY s.position, s.group_id`, [quizId]);
  return rows;
}

export async function createAttempt(database, quizId, userId, attemptNo, settings, maxPoints) {
  const { rows } = await database.query(`
    WITH started AS (SELECT clock_timestamp() AS at)
    INSERT INTO public.quiz_attempts (quiz_id, user_id, attempt_no, started_at, expires_at, settings_snapshot, max_points)
    SELECT $1, $2, $3, at, CASE WHEN $4::integer IS NULL THEN NULL ELSE at + $4 * interval '1 second' END,
      $5::jsonb, $6 FROM started RETURNING *
  `, [quizId, userId, attemptNo, settings.time_limit_seconds, JSON.stringify(settings), maxPoints]);
  return rows[0];
}

export async function createAttemptQuestions(database, attemptId, questions) {
  await database.query(`
    INSERT INTO public.quiz_attempt_questions (attempt_id, question_no, question_id, question_snapshot, max_points)
    SELECT $1, question_no, question_id, question_snapshot, max_points FROM jsonb_to_recordset($2::jsonb)
      AS input(question_no integer, question_id uuid, question_snapshot jsonb, max_points numeric)
    ORDER BY question_no
  `, [attemptId, JSON.stringify(questions)]);
}

export async function getAttemptQuestions(database, attemptId) {
  const { rows } = await database.query(`SELECT question_no, question_id, question_snapshot, max_points
    FROM public.quiz_attempt_questions WHERE attempt_id=$1 ORDER BY question_no`, [attemptId]);
  return rows;
}

export async function getQuizAttemptEligibilityState(database, quizId, userId) {
  const { rows } = await database.query(`
    SELECT q.max_attempts,
      (SELECT count(*)::integer FROM public.quiz_attempts a
        WHERE a.quiz_id = q.id AND a.user_id = $2) AS attempts_used,
      (SELECT a.id FROM public.quiz_attempts a
        WHERE a.quiz_id = q.id AND a.user_id = $2 AND a.status = 'in_progress'
          AND (a.expires_at IS NULL OR a.expires_at > now())
        LIMIT 1) AS active_attempt_id
    FROM public.quizzes q
    WHERE q.id = $1 AND q.status = 'published'
  `, [quizId, userId]);
  return rows[0] || null;
}
