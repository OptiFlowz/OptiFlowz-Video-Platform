// Caller owns the transaction and holds the attempt row lock. Issuance and
// finalization must commit together. Template selection uses the live quiz;
// its private template may belong to an editor other than the quiz owner.
export async function issueAttemptCertificate(database, attemptId) {
  const { rows } = await database.query(`
    WITH eligible AS MATERIALIZED (
      SELECT a.id AS attempt_id, a.user_id, a.quiz_id,
        t.id AS template_id, to_jsonb(t) AS template_snapshot,
        jsonb_build_object('id', u.id, 'full_name', u.full_name) AS user_data,
        to_jsonb(q) AS quiz_data,
        jsonb_build_object('score_percentage', a.score_percentage,
          'earned_points', a.earned_points, 'max_points', a.max_points,
          'passed', a.passed, 'finished_at', a.finished_at) AS result_data
      FROM public.quiz_attempts a
      JOIN public.quizzes q ON q.id=a.quiz_id
      JOIN public.certificate_templates t ON t.id=q.certificate_template_id
      JOIN public.users u ON u.id=a.user_id
      WHERE a.id=$1 AND a.status IN ('submitted', 'timed_out') AND a.passed=true
        AND NOT EXISTS (SELECT 1 FROM public.certificates c WHERE c.quiz_attempt_id=a.id)
    ), numbered AS MATERIALIZED (
      SELECT *, public.generate_certificate_number() AS certificate_number,
        now() AS issued_at FROM eligible
    )
    INSERT INTO public.certificates
      (user_id, quiz_id, quiz_attempt_id, certificate_template_id, certificate_number,
        data_snapshot, template_snapshot, issued_at)
    SELECT user_id, quiz_id, attempt_id, template_id, certificate_number,
      jsonb_build_object('user', user_data, 'quiz', quiz_data, 'result', result_data,
        'certificate', jsonb_build_object('number', certificate_number, 'issued_at', issued_at)),
      template_snapshot, issued_at
    FROM numbered
    ON CONFLICT (quiz_attempt_id) DO NOTHING
    RETURNING id, certificate_number
  `, [attemptId]);
  return rows[0] || null;
}
