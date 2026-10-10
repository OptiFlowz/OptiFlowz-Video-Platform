const GROUP_COLUMNS = 'id, user_id, name, description';

export async function createQuestionGroup(database, userId, { name, description }) {
  const { rows } = await database.query(`
    INSERT INTO public.question_groups (user_id, name, description)
    VALUES ($1, $2, $3) RETURNING ${GROUP_COLUMNS}
  `, [userId, name, description]);
  return rows[0];
}

export async function getQuestionGroup(database, groupId, userId) {
  const { rows } = await database.query(`
    SELECT ${GROUP_COLUMNS} FROM public.question_groups WHERE id = $1 AND user_id = $2
  `, [groupId, userId]);
  return rows[0] || null;
}

export async function listQuestionGroups(database, userId, { name, sortBy, sortOrder, limit, offset }) {
  // Escape LIKE wildcards so user input searches for a literal substring.
  const pattern = name ? `%${name.replace(/[\\%_]/g, '\\$&')}%` : null;
  const direction = sortOrder === 'desc' ? 'DESC' : 'ASC';
  // These are fixed, allowlisted SQL fragments; query values remain parameters.
  const ordering = sortBy === 'id' ? `id ${direction}` : `name ${direction}, id ASC`;
  const { rows } = await database.query(`
    WITH owned_groups AS (
      SELECT ${GROUP_COLUMNS} FROM public.question_groups
      WHERE user_id = $1 AND ($2::text IS NULL OR name ILIKE $2)
    ), page AS (
      SELECT * FROM owned_groups ORDER BY ${ordering} LIMIT $3 OFFSET $4
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS groups,
      (SELECT count(*)::integer FROM owned_groups) AS total
  `, [userId, pattern, limit, offset]);
  return rows[0];
}

export async function updateQuestionGroup(database, groupId, userId, updates) {
  const { rows } = await database.query(`
    UPDATE public.question_groups
    SET name = COALESCE($3::text, name),
      description = CASE WHEN $4::boolean THEN $5::text ELSE description END
    WHERE id = $1 AND user_id = $2 RETURNING ${GROUP_COLUMNS}
  `, [groupId, userId, updates.name ?? null, updates.description !== undefined, updates.description ?? null]);
  return rows[0] || null;
}

export async function deleteQuestionGroup(database, groupId, userId) {
  const { rowCount } = await database.query(
    'DELETE FROM public.question_groups WHERE id = $1 AND user_id = $2', [groupId, userId],
  );
  return rowCount > 0;
}

export async function lockGroupQuestions(database, userId, questionIds) {
  if (!questionIds.length) return true;
  const { rows } = await database.query(`
    SELECT id FROM public.questions
    WHERE user_id = $1 AND id = ANY($2::uuid[])
    ORDER BY id FOR UPDATE
  `, [userId, questionIds]);
  return rows.length === questionIds.length;
}

export async function lockQuestionGroup(database, groupId, userId) {
  const { rows } = await database.query(`
    SELECT ${GROUP_COLUMNS} FROM public.question_groups
    WHERE id = $1 AND user_id = $2 FOR UPDATE
  `, [groupId, userId]);
  return rows[0] || null;
}

export async function syncQuestionGroupQuestions(database, groupId, questionIds) {
  if (questionIds.length) {
    await database.query(`
      INSERT INTO public.question_group_items (group_id, question_id)
      SELECT $1, question_id FROM unnest($2::uuid[]) AS requested(question_id)
      ORDER BY question_id
      ON CONFLICT (group_id, question_id) DO NOTHING
    `, [groupId, questionIds]);
  }
  await database.query(`
    DELETE FROM public.question_group_items
    WHERE group_id = $1 AND NOT (question_id = ANY($2::uuid[]))
  `, [groupId, questionIds]);
  const { rows } = await database.query(
    'SELECT question_id FROM public.question_group_items WHERE group_id = $1 ORDER BY question_id', [groupId],
  );
  return rows.map(row => row.question_id);
}
