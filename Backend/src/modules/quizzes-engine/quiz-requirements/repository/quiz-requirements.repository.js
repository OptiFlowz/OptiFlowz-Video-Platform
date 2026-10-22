const COLUMNS = `r.quiz_id, r.video_id,
  r.min_watch_percentage::double precision AS min_watch_percentage, r.min_watch_seconds, r.position, r.is_active`;
const RETURNING_COLUMNS = `quiz_id, video_id,
  min_watch_percentage::double precision AS min_watch_percentage, min_watch_seconds, position, is_active`;

// Both the boolean check and the progress view use this exact, unrounded comparison.
const REQUIREMENT_MET_SQL = `CASE
  WHEN r.min_watch_seconds IS NOT NULL THEN
    COALESCE(wp.total_watch_seconds, 0) >= r.min_watch_seconds
  WHEN r.min_watch_percentage IS NOT NULL THEN
    v.duration_seconds > 0
    AND COALESCE(wp.total_watch_seconds, 0)::numeric * 100
      >= v.duration_seconds::numeric * r.min_watch_percentage
  ELSE false
END`;

export async function areQuizRequirementsMet(database, quizId, userId) {
  const { rows } = await database.query(`
    SELECT NOT EXISTS (
        SELECT 1 FROM public.quiz_requirements r
        LEFT JOIN public.videos v ON v.id = r.video_id
        LEFT JOIN public.watch_progress wp ON wp.video_id = r.video_id AND wp.user_id = $2
        WHERE r.quiz_id = $1 AND r.is_active = true AND (${REQUIREMENT_MET_SQL}) IS NOT TRUE
      ) AS requirements_met
    FROM public.quizzes WHERE id = $1 AND status = 'published'
  `, [quizId, userId]);
  return rows[0]?.requirements_met ?? null;
}

export async function getQuizRequirementsProgress(database, quizId, userId) {
  const { rows } = await database.query(`
    WITH requirement_progress AS (
      SELECT ${COLUMNS},
        COALESCE(wp.total_watch_seconds, 0)::numeric AS total_watch_seconds,
        CASE
          WHEN r.min_watch_seconds IS NOT NULL THEN r.min_watch_seconds::numeric
          WHEN v.duration_seconds > 0 THEN v.duration_seconds::numeric * r.min_watch_percentage / 100
        END AS required_watch_seconds,
        CASE WHEN v.duration_seconds > 0 THEN
          LEAST(100, TRUNC(COALESCE(wp.total_watch_seconds, 0)::numeric * 100 / v.duration_seconds::numeric, 2))
        END AS watched_percentage,
        (${REQUIREMENT_MET_SQL}) IS TRUE AS is_met
      FROM public.quiz_requirements r
      LEFT JOIN public.videos v ON v.id = r.video_id
      LEFT JOIN public.watch_progress wp ON wp.video_id = r.video_id AND wp.user_id = $2
      WHERE r.quiz_id = $1 AND r.is_active = true
    ), progress AS (
      SELECT *, CASE WHEN required_watch_seconds > 0 THEN
        LEAST(100, TRUNC(total_watch_seconds * 100 / required_watch_seconds, 2))
      END AS completion_percentage
      FROM requirement_progress
    )
    SELECT id AS quiz_id,
      COALESCE((SELECT jsonb_agg(to_jsonb(progress) ORDER BY position, video_id) FROM progress), '[]'::jsonb) AS requirements
    FROM public.quizzes WHERE id = $1 AND status = 'published'
  `, [quizId, userId]);
  return rows[0] || null;
}

export async function getOwnedQuiz(database, quizId, userId, lock = false) {
  const { rows } = await database.query(`
    SELECT id FROM public.quizzes WHERE id = $1 AND user_id = $2 ${lock ? 'FOR SHARE' : ''}
  `, [quizId, userId]);
  return rows[0] || null;
}

export async function lockAccessibleVideo(database, videoId, userId) {
  const { rows } = await database.query(`
    SELECT id, duration_seconds FROM public.videos
    WHERE id = $1 AND mux_status = 'ready'
      AND ((visibility = 'public' AND published_at <= NOW())
        OR (visibility IN ('public', 'private') AND uploaded_by = $2))
    FOR SHARE
  `, [videoId, userId]);
  return rows[0] || null;
}

export async function createQuizRequirement(database, requirement) {
  const { quiz_id, video_id, min_watch_percentage, min_watch_seconds, position, is_active = true } = requirement;
  const { rows } = await database.query(`
    INSERT INTO public.quiz_requirements (quiz_id, video_id, min_watch_percentage, min_watch_seconds, position, is_active)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${RETURNING_COLUMNS}
  `, [quiz_id, video_id, min_watch_percentage, min_watch_seconds, position, is_active]);
  return rows[0];
}

export async function getQuizRequirement(database, quizId, videoId, userId, lock = false) {
  const { rows } = await database.query(`
    SELECT ${COLUMNS} FROM public.quiz_requirements r
    JOIN public.quizzes q ON q.id = r.quiz_id
    WHERE r.quiz_id = $1 AND r.video_id = $2 AND q.user_id = $3
    ${lock ? 'FOR UPDATE OF r' : ''}
  `, [quizId, videoId, userId]);
  return rows[0] || null;
}

export async function listQuizRequirements(database, userId, { quiz_id, sortBy, sortOrder, limit, offset }) {
  const fields = {
    position: 'position', quiz_id: 'quiz_id', video_id: 'video_id',
    min_watch_percentage: 'min_watch_percentage', min_watch_seconds: 'min_watch_seconds',
  };
  const direction = sortOrder === 'desc' ? 'DESC' : 'ASC';
  const ordering = `${fields[sortBy]} ${direction} NULLS LAST, quiz_id ASC, video_id ASC`;
  const { rows } = await database.query(`
    WITH owned_requirements AS (
      SELECT ${COLUMNS} FROM public.quiz_requirements r
      JOIN public.quizzes q ON q.id = r.quiz_id
      WHERE ($1::uuid IS NULL OR q.user_id = $1) AND ($2::uuid IS NULL OR r.quiz_id = $2)
    ), page AS (
      SELECT * FROM owned_requirements ORDER BY ${ordering} LIMIT $3 OFFSET $4
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS requirements,
      (SELECT count(*)::integer FROM owned_requirements) AS total
  `, [userId, quiz_id ?? null, limit, offset]);
  return rows[0];
}

export async function updateQuizRequirement(database, quizId, videoId, userId, requirement) {
  const { rows } = await database.query(`
    UPDATE public.quiz_requirements r
    SET min_watch_percentage = $4, min_watch_seconds = $5, position = $6, is_active = $7
    FROM public.quizzes q
    WHERE r.quiz_id = $1 AND r.video_id = $2 AND q.id = r.quiz_id AND q.user_id = $3
    RETURNING ${COLUMNS}
  `, [quizId, videoId, userId, requirement.min_watch_percentage, requirement.min_watch_seconds, requirement.position, requirement.is_active]);
  return rows[0] || null;
}

export async function deleteQuizRequirement(database, quizId, videoId, userId) {
  const { rowCount } = await database.query(`
    DELETE FROM public.quiz_requirements r USING public.quizzes q
    WHERE r.quiz_id = $1 AND r.video_id = $2 AND q.id = r.quiz_id AND q.user_id = $3
  `, [quizId, videoId, userId]);
  return rowCount > 0;
}
