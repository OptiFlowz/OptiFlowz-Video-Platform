const QUIZ_COLUMNS = `id, user_id, title, description, status, question_count,
  time_limit_seconds, max_attempts, passing_score_percentage::double precision AS passing_score_percentage,
  shuffle_questions, shuffle_options, has_certificate, created_at, updated_at`;

const WRITABLE_FIELDS = [
  'title', 'description', 'status', 'question_count', 'time_limit_seconds', 'max_attempts',
  'passing_score_percentage', 'shuffle_questions', 'shuffle_options', 'has_certificate',
];

export async function createQuiz(database, userId, quiz) {
  const placeholders = WRITABLE_FIELDS.map((_, index) => `$${index + 2}`);
  const { rows } = await database.query(`
    INSERT INTO public.quizzes (user_id, ${WRITABLE_FIELDS.join(', ')})
    VALUES ($1, ${placeholders.join(', ')}) RETURNING ${QUIZ_COLUMNS}
  `, [userId, ...WRITABLE_FIELDS.map(field => quiz[field])]);
  return rows[0];
}

export async function getQuiz(database, quizId, userId) {
  const { rows } = await database.query(`
    SELECT ${QUIZ_COLUMNS} FROM public.quizzes WHERE id = $1 AND user_id = $2
  `, [quizId, userId]);
  return rows[0] || null;
}

export async function listQuizzes(database, userId, { title, status, limit, offset, sortBy, sortOrder }) {
  const pattern = title ? `%${title.replace(/[\\%_]/g, '\\$&')}%` : null;
  const fields = {
    created_at: 'created_at', updated_at: 'updated_at', title: 'title', status: 'status',
    question_count: 'question_count', passing_score_percentage: 'passing_score_percentage',
  };
  const field = fields[sortBy];
  const direction = sortOrder === 'desc' ? 'DESC' : 'ASC';
  // Only constant, allowlisted SQL identifiers and directions are interpolated.
  const ordering = `${field} ${direction}, id ASC`;
  const { rows } = await database.query(`
    WITH owned_quizzes AS (
      SELECT ${QUIZ_COLUMNS} FROM public.quizzes
      WHERE user_id = $1 AND ($2::text IS NULL OR title ILIKE $2)
        AND ($3::public.quiz_status IS NULL OR status = $3)
    ), page AS (
      SELECT * FROM owned_quizzes ORDER BY ${ordering} LIMIT $4 OFFSET $5
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS quizzes,
      (SELECT count(*)::integer FROM owned_quizzes) AS total
  `, [userId, pattern, status ?? null, limit, offset]);
  return rows[0];
}

export async function updateQuiz(database, quizId, userId, updates) {
  // Fixed writable fields ensure body keys cannot become arbitrary SQL identifiers.
  const fields = WRITABLE_FIELDS.filter(field => updates[field] !== undefined);
  const assignments = fields.map((field, index) => `${field} = $${index + 3}`);
  const { rows } = await database.query(`
    UPDATE public.quizzes SET ${assignments.join(', ')}, updated_at = now()
    WHERE id = $1 AND user_id = $2 RETURNING ${QUIZ_COLUMNS}
  `, [quizId, userId, ...fields.map(field => updates[field])]);
  return rows[0] || null;
}

export async function deleteQuiz(database, quizId, userId) {
  const { rowCount } = await database.query(
    'DELETE FROM public.quizzes WHERE id = $1 AND user_id = $2', [quizId, userId],
  );
  return rowCount > 0;
}
