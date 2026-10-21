export async function claimExpiredAttempts(database, batchSize, cursor) {
  const { rows } = await database.query(`
    SELECT id, expires_at::text AS cursor_expires_at FROM public.quiz_attempts
    WHERE status='in_progress' AND expires_at IS NOT NULL AND expires_at <= statement_timestamp()
      AND ($2::timestamptz IS NULL OR (expires_at,id) > ($2::timestamptz,$3::uuid))
    ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
  `, [batchSize, cursor?.expiresAt ?? null, cursor?.id ?? null]);
  return rows;
}

export async function lockAttemptForFinalization(database, attemptId) {
  const { rows } = await database.query('SELECT * FROM public.quiz_attempts WHERE id=$1 FOR UPDATE', [attemptId]);
  return rows[0] || null;
}

export async function timeOutAttempt(database, attemptId, summary) {
  const { rows } = await database.query(`
    UPDATE public.quiz_attempts SET status='timed_out', finished_at=expires_at,
      earned_points=$2, max_points=$3, score_percentage=$4, passed=$5
    WHERE id=$1 AND status='in_progress' AND expires_at IS NOT NULL AND expires_at <= clock_timestamp()
    RETURNING id
  `, [attemptId, summary.earned_points, summary.max_points, summary.score_percentage, summary.passed]);
  return rows[0] || null;
}
