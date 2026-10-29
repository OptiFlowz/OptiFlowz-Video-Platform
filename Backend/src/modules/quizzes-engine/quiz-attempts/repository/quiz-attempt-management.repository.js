// Author-only projections must never be used by participant endpoints.
const AUTHOR_ATTEMPT_FIELDS = `
  a.id, a.quiz_id, a.attempt_no, a.status, a.started_at, a.expires_at, a.finished_at,
  a.earned_points::double precision AS earned_points, a.max_points::double precision AS max_points,
  a.score_percentage::double precision AS score_percentage, a.passed,
  jsonb_build_object('id', u.id, 'full_name', u.full_name, 'image_url', u.image_url) AS "user"`;

function resultOrdering(query) {
  const fields = { started_at: 'started_at', finished_at: 'finished_at', attempt_no: 'attempt_no',
    status: 'status', earned_points: 'earned_points', score_percentage: 'score_percentage' };
  const direction = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
  return `${fields[query.sortBy]} ${direction} NULLS LAST, id ASC`;
}

export async function listQuizResults(database, quizId, ownerId, query) {
  const ordering = resultOrdering(query);
  const { rows } = await database.query(`
    WITH owned_quiz AS (
      SELECT id FROM public.quizzes WHERE id=$1 AND user_id=$2
    ), filtered AS (
      SELECT ${AUTHOR_ATTEMPT_FIELDS}
      FROM public.quiz_attempts a JOIN owned_quiz q ON q.id=a.quiz_id
      JOIN public.users u ON u.id=a.user_id
      WHERE ($3::uuid IS NULL OR a.user_id=$3)
        AND ($4::public.quiz_attempt_status IS NULL OR a.status=$4)
        AND ($5::boolean IS NULL OR a.passed=$5)
    ), page AS (
      SELECT * FROM filtered ORDER BY ${ordering} LIMIT $6 OFFSET $7
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS attempts,
      (SELECT count(*)::integer FROM filtered) AS total
    FROM owned_quiz
  `, [quizId, ownerId, query.user_id ?? null, query.status ?? null, query.passed ?? null,
    query.limit, (query.page - 1) * query.limit]);
  return rows[0] || null;
}

export async function listQuizResultsByUser(database, quizId, ownerId, query) {
  const ordering = resultOrdering(query);
  const { rows } = await database.query(`
    WITH owned_quiz AS (
      SELECT id FROM public.quizzes WHERE id=$1 AND user_id=$2
    ), filtered AS (
      SELECT a.user_id AS participant_id, ${AUTHOR_ATTEMPT_FIELDS}
      FROM public.quiz_attempts a JOIN owned_quiz q ON q.id=a.quiz_id
      JOIN public.users u ON u.id=a.user_id
      WHERE ($3::uuid IS NULL OR a.user_id=$3)
        AND ($4::public.quiz_attempt_status IS NULL OR a.status=$4)
        AND ($5::boolean IS NULL OR a.passed=$5)
    ), representatives AS (
      SELECT DISTINCT ON (participant_id) * FROM filtered
      ORDER BY participant_id, ${ordering}
    ), page AS (
      SELECT * FROM representatives ORDER BY ${ordering} LIMIT $6 OFFSET $7
    )
    SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'user', page."user",
      'attempts', (SELECT jsonb_agg(to_jsonb(f) - 'participant_id' - 'user' ORDER BY ${ordering})
        FROM filtered f WHERE f.participant_id=page.participant_id)
      ) ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS users,
      (SELECT count(*)::integer FROM representatives) AS total
    FROM owned_quiz
  `, [quizId, ownerId, query.user_id ?? null, query.status ?? null, query.passed ?? null,
    query.limit, (query.page - 1) * query.limit]);
  // Page whole users, then include every matching attempt for those users.
  // Each user's first sorted attempt determines the group's position.
  return rows[0] || null;
}

export async function getQuizResult(database, quizId, attemptId, ownerId) {
  // One snapshot-consistent query: no grading or finalization on a read.
  const { rows } = await database.query(`
    SELECT ${AUTHOR_ATTEMPT_FIELDS}, a.settings_snapshot AS settings,
      a.expires_at IS NOT NULL AND a.expires_at <= statement_timestamp() AS is_expired,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'question_no', aq.question_no, 'question_id', aq.question_id,
        'max_points', aq.max_points, 'question_snapshot', aq.question_snapshot,
        'answer', ans.answer, 'checked_at', ans.checked_at, 'updated_at', ans.updated_at,
        'is_correct', ans.is_correct, 'awarded_points', ans.awarded_points, 'can_edit', false
      ) ORDER BY aq.question_no)
        FROM public.quiz_attempt_questions aq
        LEFT JOIN public.quiz_attempt_answers ans ON ans.attempt_id=aq.attempt_id AND ans.question_no=aq.question_no
        WHERE aq.attempt_id=a.id), '[]'::jsonb) AS questions
    FROM public.quiz_attempts a JOIN public.quizzes q ON q.id=a.quiz_id
    JOIN public.users u ON u.id=a.user_id
    WHERE a.id=$1 AND a.quiz_id=$2 AND q.user_id=$3
  `, [attemptId, quizId, ownerId]);
  return rows[0] || null;
}

export async function getManagedAttemptParticipant(database, quizId, attemptId, ownerId) {
  const { rows } = await database.query(`
    SELECT a.user_id FROM public.quiz_attempts a JOIN public.quizzes q ON q.id=a.quiz_id
    WHERE a.id=$1 AND a.quiz_id=$2 AND q.user_id=$3
  `, [attemptId, quizId, ownerId]);
  return rows[0]?.user_id || null;
}

export async function deleteManagedQuizAttempt(database, quizId, attemptId, ownerId) {
  // Cascades delete attempt questions/answers; issued certificates retain their snapshots.
  const { rows } = await database.query(`
    DELETE FROM public.quiz_attempts a USING public.quizzes q
    WHERE a.id=$1 AND a.quiz_id=$2 AND q.id=a.quiz_id AND q.user_id=$3
    RETURNING a.id
  `, [attemptId, quizId, ownerId]);
  return rows[0] || null;
}
