const QUESTION_COLUMNS = 'id, user_id, type, content, explanation, created_at, updated_at';

export async function getQuestion(database, questionId, userId) {
  // A single statement gives the parent and its children one consistent snapshot.
  const { rows } = await database.query(`
    SELECT q.id, q.user_id, q.type, q.content, q.explanation, q.created_at, q.updated_at,
      COALESCE((SELECT jsonb_agg(to_jsonb(o) - 'question_id' ORDER BY o.position, o.option_no)
        FROM public.question_options o WHERE o.question_id = q.id), '[]'::jsonb) AS options,
      COALESCE((SELECT jsonb_agg(to_jsonb(o) - 'question_id' ORDER BY o.position, o.option_no)
        FROM public.question_matching_options o WHERE o.question_id = q.id), '[]'::jsonb) AS matching_options,
      COALESCE((SELECT jsonb_agg(to_jsonb(i) - 'question_id' ORDER BY i.position, i.item_no)
        FROM public.question_matching_items i WHERE i.question_id = q.id), '[]'::jsonb) AS matching_items,
      COALESCE((SELECT jsonb_agg(gi.group_id ORDER BY gi.group_id)
        FROM public.question_group_items gi WHERE gi.question_id = q.id), '[]'::jsonb) AS group_ids
    FROM public.questions q WHERE q.id = $1 AND q.user_id = $2
  `, [questionId, userId]);
  return rows[0] || null;
}

export async function listQuestions(database, userId, { type, limit, offset, sortBy, sortOrder }) {
  const allowedSortFields = {
    created_at: 'created_at',
    updated_at: 'updated_at',
    content: 'content',
    type: 'type',
  };
  const orderByField = allowedSortFields[sortBy];
  const orderByDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';
  // Only allowlisted identifiers/directions are interpolated. UUID breaks ties
  // consistently, keeping page boundaries stable for equal sort values.
  const { rows } = await database.query(`
    WITH owned_questions AS (
      SELECT ${QUESTION_COLUMNS} FROM public.questions
      WHERE user_id = $1 AND ($2::public.question_type IS NULL OR type = $2)
    ), page AS (
      SELECT * FROM owned_questions ORDER BY ${orderByField} ${orderByDirection}, id ASC LIMIT $3 OFFSET $4
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${orderByField} ${orderByDirection}, id ASC) FROM page), '[]'::jsonb) AS questions,
      (SELECT count(*)::integer FROM owned_questions) AS total
  `, [userId, type ?? null, limit, offset]);
  return rows[0];
}

export async function lockQuestion(database, questionId, userId) {
  const { rows } = await database.query(
    'SELECT id FROM public.questions WHERE id = $1 AND user_id = $2 FOR UPDATE',
    [questionId, userId],
  );
  return rows.length > 0;
}

export async function lockQuestionGroups(database, userId, groupIds) {
  const { rows } = await database.query(`
    SELECT id FROM public.question_groups
    WHERE user_id = $1 AND id = ANY($2::uuid[])
    ORDER BY id FOR SHARE
  `, [userId, groupIds]);
  return rows.length === groupIds.length;
}

async function saveGroups(database, questionId, groupIds) {
  // Omission means preserve memberships; an explicit empty array clears them.
  if (groupIds === undefined) return;
  if (groupIds.length) {
    await database.query(`
      INSERT INTO public.question_group_items (group_id, question_id)
      SELECT group_id, $1 FROM unnest($2::uuid[]) AS requested(group_id)
      ORDER BY group_id
      ON CONFLICT (group_id, question_id) DO NOTHING
    `, [questionId, groupIds]);
  }
  await database.query(`
    DELETE FROM public.question_group_items
    WHERE question_id = $1 AND NOT (group_id = ANY($2::uuid[]))
  `, [questionId, groupIds]);
}

async function saveChildren(database, questionId, question) {
  if (question.type === 'matching') {
    await database.query('DELETE FROM public.question_options WHERE question_id = $1', [questionId]);
    if (question.matching_options.length) {
      await database.query(`
        INSERT INTO public.question_matching_options (question_id, option_no, content, position)
        SELECT $1, option_no, content, position FROM jsonb_to_recordset($2::jsonb)
          AS input(option_no smallint, content text, position integer)
        ON CONFLICT (question_id, option_no)
        DO UPDATE SET content = EXCLUDED.content, position = EXCLUDED.position
      `, [questionId, JSON.stringify(question.matching_options)]);
    }
    if (question.matching_items.length) {
      await database.query(`
        INSERT INTO public.question_matching_items (question_id, item_no, content, correct_option_no, position)
        SELECT $1, item_no, content, correct_option_no, position FROM jsonb_to_recordset($2::jsonb)
          AS input(item_no smallint, content text, correct_option_no smallint, position integer)
        ON CONFLICT (question_id, item_no)
        DO UPDATE SET content = EXCLUDED.content, correct_option_no = EXCLUDED.correct_option_no,
          position = EXCLUDED.position
      `, [questionId, JSON.stringify(question.matching_items)]);
    }
    // Remove obsolete items before options so the composite FK remains valid.
    await database.query('DELETE FROM public.question_matching_items WHERE question_id = $1 AND NOT (item_no = ANY($2::smallint[]))',
      [questionId, question.matching_items.map(item => item.item_no)]);
    await database.query('DELETE FROM public.question_matching_options WHERE question_id = $1 AND NOT (option_no = ANY($2::smallint[]))',
      [questionId, question.matching_options.map(option => option.option_no)]);
  } else {
    await database.query('DELETE FROM public.question_matching_items WHERE question_id = $1', [questionId]);
    await database.query('DELETE FROM public.question_matching_options WHERE question_id = $1', [questionId]);
    if (question.options.length) {
      await database.query(`
        INSERT INTO public.question_options (question_id, option_no, content, is_correct, position)
        SELECT $1, option_no, content, is_correct, position FROM jsonb_to_recordset($2::jsonb)
          AS input(option_no smallint, content text, is_correct boolean, position integer)
        ON CONFLICT (question_id, option_no)
        DO UPDATE SET content = EXCLUDED.content, is_correct = EXCLUDED.is_correct, position = EXCLUDED.position
      `, [questionId, JSON.stringify(question.options)]);
    }
    await database.query('DELETE FROM public.question_options WHERE question_id = $1 AND NOT (option_no = ANY($2::smallint[]))',
      [questionId, question.options.map(option => option.option_no)]);
  }
}

export async function createQuestion(database, userId, question) {
  const { rows } = await database.query(`
    INSERT INTO public.questions (user_id, type, content, explanation)
    VALUES ($1, $2, $3, $4) RETURNING id
  `, [userId, question.type, question.content, question.explanation]);
  const questionId = rows[0].id;
  await saveChildren(database, questionId, question);
  await saveGroups(database, questionId, question.group_ids);
  return getQuestion(database, questionId, userId);
}

export async function updateQuestion(database, questionId, userId, question, updateChildren) {
  await database.query(`
    UPDATE public.questions SET type = $3, content = $4, explanation = $5, updated_at = now()
    WHERE id = $1 AND user_id = $2
  `, [questionId, userId, question.type, question.content, question.explanation]);
  if (updateChildren) await saveChildren(database, questionId, question);
  await saveGroups(database, questionId, question.group_ids);
  return getQuestion(database, questionId, userId);
}

export async function deleteQuestion(database, questionId, userId) {
  const { rowCount } = await database.query(
    'DELETE FROM public.questions WHERE id = $1 AND user_id = $2', [questionId, userId],
  );
  return rowCount > 0;
}
