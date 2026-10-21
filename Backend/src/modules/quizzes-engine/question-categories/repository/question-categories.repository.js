const CATEGORY_COLUMNS = 'id, user_id, name, description';

export async function createQuestionCategory(database, userId, { name, description }) {
  const { rows } = await database.query(`
    INSERT INTO public.question_categories (user_id, name, description)
    VALUES ($1, $2, $3) RETURNING ${CATEGORY_COLUMNS}
  `, [userId, name, description]);
  return rows[0];
}

export async function getQuestionCategory(database, categoryId, userId) {
  const { rows } = await database.query(`
    SELECT ${CATEGORY_COLUMNS} FROM public.question_categories WHERE id = $1 AND user_id = $2
  `, [categoryId, userId]);
  return rows[0] || null;
}

export async function getQuestionCategoryDetails(database, categoryId, userId) {
  // Read category metadata and its question list from the same database snapshot.
  const { rows } = await database.query(`
    SELECT g.id, g.user_id, g.name, g.description,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(question) ORDER BY question.created_at, question.id)
        FROM (
          SELECT q.id, q.user_id, q.type, q.content, q.explanation, q.max_points::double precision AS max_points, q.created_at, q.updated_at,
            jsonb_build_object('id', g.id, 'name', g.name) AS category
          FROM public.questions q
          WHERE q.category_id=g.id AND q.user_id=g.user_id
        ) question
      ), '[]'::jsonb) AS questions
    FROM public.question_categories g WHERE g.id = $1 AND g.user_id = $2
  `, [categoryId, userId]);
  return rows[0] || null;
}

export async function listQuestionCategories(database, userId, { name, sortBy, sortOrder, limit, offset }) {
  // Escape LIKE wildcards so user input searches for a literal substring.
  const pattern = name ? `%${name.replace(/[\\%_]/g, '\\$&')}%` : null;
  const direction = sortOrder === 'desc' ? 'DESC' : 'ASC';
  // These are fixed, allowlisted SQL fragments; query values remain parameters.
  const ordering = sortBy === 'id' ? `id ${direction}` : `name ${direction}, id ASC`;
  const { rows } = await database.query(`
    WITH owned_categories AS (
      SELECT ${CATEGORY_COLUMNS} FROM public.question_categories
      WHERE ($1::uuid IS NULL OR user_id = $1) AND ($2::text IS NULL OR name ILIKE $2)
    ), page AS (
      SELECT * FROM owned_categories ORDER BY ${ordering} LIMIT $3 OFFSET $4
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS categories,
      (SELECT count(*)::integer FROM owned_categories) AS total
  `, [userId, pattern, limit, offset]);
  return rows[0];
}

export async function updateQuestionCategory(database, categoryId, userId, updates) {
  const { rows } = await database.query(`
    UPDATE public.question_categories
    SET name = COALESCE($3::text, name),
      description = CASE WHEN $4::boolean THEN $5::text ELSE description END
    WHERE id = $1 AND user_id = $2 RETURNING ${CATEGORY_COLUMNS}
  `, [categoryId, userId, updates.name ?? null, updates.description !== undefined, updates.description ?? null]);
  return rows[0] || null;
}

export async function deleteQuestionCategory(database, categoryId, userId) {
  const { rowCount } = await database.query(
    'DELETE FROM public.question_categories WHERE id = $1 AND user_id = $2', [categoryId, userId],
  );
  return rowCount > 0;
}

export async function lockCategoryQuestions(database, userId, questionIds) {
  if (!questionIds.length) return true;
  const { rows } = await database.query(`
    SELECT id FROM public.questions
    WHERE user_id = $1 AND id = ANY($2::uuid[])
    ORDER BY id FOR UPDATE
  `, [userId, questionIds]);
  return rows.length === questionIds.length;
}

export async function lockQuestionCategory(database, categoryId, userId) {
  const { rows } = await database.query(`
    SELECT ${CATEGORY_COLUMNS} FROM public.question_categories
    WHERE id = $1 AND user_id = $2 FOR UPDATE
  `, [categoryId, userId]);
  return rows[0] || null;
}

export async function syncQuestionCategoryQuestions(database, categoryId, questionIds) {
  await database.query(`UPDATE public.questions SET category_id=NULL, updated_at=now()
    WHERE category_id=$1 AND NOT (id=ANY($2::uuid[]))`, [categoryId, questionIds]);
  await database.query(`UPDATE public.questions SET category_id=$1, updated_at=now()
    WHERE id=ANY($2::uuid[]) AND category_id IS DISTINCT FROM $1`, [categoryId, questionIds]);
  const { rows } = await database.query('SELECT id FROM public.questions WHERE category_id=$1 ORDER BY id', [categoryId]);
  return rows.map(row => row.id);
}
