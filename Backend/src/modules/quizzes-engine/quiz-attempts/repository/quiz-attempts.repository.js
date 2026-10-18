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
