const COLUMNS = `qq.quiz_id, qq.question_id, qq.position,
  qq.max_points::double precision AS max_points,
  jsonb_build_object('id', q.id, 'type', q.type, 'content', q.content, 'explanation', q.explanation) AS question`;

export async function getOwnedQuiz(database, quizId, userId, lock = false) {
  const { rows } = await database.query(`
    SELECT id FROM public.quizzes WHERE id = $1 AND user_id = $2 ${lock ? 'FOR NO KEY UPDATE' : ''}
  `, [quizId, userId]);
  return rows[0] || null;
}

export async function lockOwnedQuestion(database, questionId, userId) {
  const { rows } = await database.query(
    'SELECT id FROM public.questions WHERE id = $1 AND user_id = $2 FOR SHARE', [questionId, userId],
  );
  return rows[0] || null;
}

export async function getQuizQuestion(database, quizId, questionId, userId) {
  const { rows } = await database.query(`
    SELECT ${COLUMNS} FROM public.quiz_questions qq
    JOIN public.quizzes quiz ON quiz.id = qq.quiz_id
    JOIN public.questions q ON q.id = qq.question_id
    WHERE qq.quiz_id = $1 AND qq.question_id = $2 AND quiz.user_id = $3 AND q.user_id = $3
  `, [quizId, questionId, userId]);
  return rows[0] || null;
}

export async function listQuizQuestions(database, quizId, userId, { limit, offset, sortBy, sortOrder }) {
  const fields = { position: 'position', max_points: 'max_points', question_id: 'question_id' };
  const direction = sortOrder === 'desc' ? 'DESC' : 'ASC';
  const ordering = `${fields[sortBy]} ${direction}, question_id ASC`;
  const { rows } = await database.query(`
    WITH owned_questions AS (
      SELECT ${COLUMNS} FROM public.quiz_questions qq
      JOIN public.quizzes quiz ON quiz.id = qq.quiz_id
      JOIN public.questions q ON q.id = qq.question_id
      WHERE qq.quiz_id = $1 AND quiz.user_id = $2 AND q.user_id = $2
    ), page AS (
      SELECT * FROM owned_questions ORDER BY ${ordering} LIMIT $3 OFFSET $4
    ), enriched_page AS (
      SELECT page.quiz_id, page.question_id, page.position, page.max_points,
        page.question || jsonb_build_object('category', (
          SELECT jsonb_build_object('id', c.id, 'name', c.name)
          FROM public.questions q JOIN public.question_categories c ON c.id=q.category_id
          WHERE q.id=page.question_id AND c.user_id=$2
        )) AS question
      FROM page
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(enriched_page) ORDER BY ${ordering}) FROM enriched_page), '[]'::jsonb) AS questions,
      (SELECT count(*)::integer FROM owned_questions) AS total
  `, [quizId, userId, limit, offset]);
  return rows[0];
}

export async function createQuizQuestion(database, quizId, userId, input) {
  await database.query(`
    INSERT INTO public.quiz_questions (quiz_id, question_id, position, max_points) VALUES ($1, $2, $3, $4)
  `, [quizId, input.question_id, input.position, input.max_points]);
  return getQuizQuestion(database, quizId, input.question_id, userId);
}

export async function updateQuizQuestion(database, quizId, questionId, userId, updates) {
  // The transaction holds the quiz lock before reading the old position, so
  // concurrent moves cannot calculate shifts from the same stale ordering.
  const { rowCount } = await database.query(`
    WITH current_question AS (
      SELECT qq.position FROM public.quiz_questions qq
      JOIN public.quizzes quiz ON quiz.id = qq.quiz_id
      JOIN public.questions q ON q.id = qq.question_id
      WHERE qq.quiz_id = $1 AND qq.question_id = $2 AND quiz.user_id = $3 AND q.user_id = $3
      FOR UPDATE OF qq
    )
    UPDATE public.quiz_questions qq
    SET position = CASE
      WHEN qq.question_id = $2 THEN COALESCE($4::integer, qq.position)
      WHEN $4 < current_question.position THEN qq.position + 1
      ELSE qq.position - 1
    END,
    max_points = CASE WHEN qq.question_id = $2 THEN COALESCE($5::numeric, qq.max_points) ELSE qq.max_points END
    FROM current_question
    WHERE qq.quiz_id = $1 AND (
      qq.question_id = $2
      OR ($4 < current_question.position AND qq.position >= $4 AND qq.position < current_question.position)
      OR ($4 > current_question.position AND qq.position > current_question.position AND qq.position <= $4)
    )
  `, [quizId, questionId, userId, updates.position ?? null, updates.max_points ?? null]);
  return rowCount ? getQuizQuestion(database, quizId, questionId, userId) : null;
}

export async function deleteQuizQuestion(database, quizId, questionId, userId) {
  const { rowCount } = await database.query(`
    DELETE FROM public.quiz_questions qq USING public.quizzes quiz, public.questions q
    WHERE qq.quiz_id = $1 AND qq.question_id = $2 AND quiz.id = qq.quiz_id AND q.id = qq.question_id
      AND quiz.user_id = $3 AND q.user_id = $3
  `, [quizId, questionId, userId]);
  return rowCount > 0;
}
