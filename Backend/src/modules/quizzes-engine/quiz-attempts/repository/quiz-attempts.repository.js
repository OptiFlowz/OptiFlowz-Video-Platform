export async function listQuizAttempts(database, quizId, userId, { status, limit, offset, sortBy, sortOrder }) {
  const fields = { started_at: 'started_at', finished_at: 'finished_at', attempt_no: 'attempt_no', status: 'status' };
  const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
  const ordering = `${fields[sortBy]} ${direction} NULLS LAST, id ASC`;
  const { rows } = await database.query(`
    WITH visible_quiz AS (
      SELECT id FROM public.quizzes WHERE id = $1 AND (status = 'published' OR user_id = $2)
    ), owned_attempts AS (
      SELECT a.id, a.quiz_id, a.attempt_no, a.status, a.started_at, a.expires_at, a.finished_at,
        a.max_points::double precision AS max_points, a.settings_snapshot AS settings,
        CASE WHEN a.status IN ('submitted', 'timed_out') AND a.settings_snapshot->>'show_final_score' = 'true'
          THEN a.earned_points::double precision END AS earned_points,
        CASE WHEN a.status IN ('submitted', 'timed_out') AND a.settings_snapshot->>'show_final_score' = 'true'
          THEN a.score_percentage::double precision END AS score_percentage,
        CASE WHEN a.status IN ('submitted', 'timed_out') AND a.settings_snapshot->>'show_final_score' = 'true'
          THEN a.passed END AS passed
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
