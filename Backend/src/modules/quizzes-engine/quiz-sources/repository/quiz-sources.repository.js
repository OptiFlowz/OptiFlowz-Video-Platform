const COLUMNS = `s.quiz_id, s.group_id, s.position,
  s.question_percentage::double precision AS question_percentage, s.question_count,
  jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description) AS group`;

export async function getOwnedQuiz(database, quizId, userId, lock = false) {
  const { rows } = await database.query(`
    SELECT id, question_count FROM public.quizzes WHERE id = $1 AND user_id = $2 ${lock ? 'FOR UPDATE' : ''}
  `, [quizId, userId]);
  return rows[0] || null;
}

export async function lockOwnedGroups(database, groupIds, userId) {
  const { rows } = await database.query(`
    SELECT id FROM public.question_groups WHERE id = ANY($1::uuid[]) AND user_id = $2 ORDER BY id FOR SHARE
  `, [groupIds, userId]);
  return rows.length === groupIds.length;
}

export async function getQuizSource(database, quizId, groupId, userId) {
  const { rows } = await database.query(`
    SELECT ${COLUMNS} FROM public.quiz_sources s
    JOIN public.quizzes q ON q.id = s.quiz_id JOIN public.question_groups g ON g.id = s.group_id
    WHERE s.quiz_id = $1 AND s.group_id = $2 AND q.user_id = $3 AND g.user_id = $3
  `, [quizId, groupId, userId]);
  return rows[0] || null;
}

export async function listQuizSources(database, quizId, userId, { limit, offset, sortBy, sortOrder }) {
  const fields = { position: 'position', group_id: 'group_id', question_percentage: 'question_percentage', question_count: 'question_count' };
  const direction = sortOrder === 'desc' ? 'DESC' : 'ASC';
  const ordering = `${fields[sortBy]} ${direction} NULLS LAST, group_id ASC`;
  const { rows } = await database.query(`
    WITH owned_sources AS (
      SELECT ${COLUMNS} FROM public.quiz_sources s
      JOIN public.quizzes q ON q.id = s.quiz_id JOIN public.question_groups g ON g.id = s.group_id
      WHERE s.quiz_id = $1 AND q.user_id = $2 AND g.user_id = $2
    ), page AS (
      SELECT * FROM owned_sources ORDER BY ${ordering} LIMIT $3 OFFSET $4
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS sources,
      (SELECT count(*)::integer FROM owned_sources) AS total
  `, [quizId, userId, limit, offset]);
  return rows[0];
}

export async function createQuizSource(database, quizId, userId, source) {
  await database.query(`INSERT INTO public.quiz_sources (quiz_id, group_id, position, question_percentage, question_count)
    VALUES ($1, $2, $3, $4, $5)`, [quizId, source.group_id, source.position, source.question_percentage, source.question_count]);
  return getQuizSource(database, quizId, source.group_id, userId);
}

export async function updateQuizSource(database, quizId, groupId, userId, source) {
  await database.query(`UPDATE public.quiz_sources SET position=$3, question_percentage=$4, question_count=$5
    WHERE quiz_id=$1 AND group_id=$2`, [quizId, groupId, source.position, source.question_percentage, source.question_count]);
  return getQuizSource(database, quizId, groupId, userId);
}

export async function deleteQuizSource(database, quizId, groupId) {
  const { rowCount } = await database.query('DELETE FROM public.quiz_sources WHERE quiz_id=$1 AND group_id=$2', [quizId, groupId]);
  return rowCount > 0;
}

export async function replaceQuizSources(database, quizId, userId, sources) {
  await database.query('DELETE FROM public.quiz_sources WHERE quiz_id=$1', [quizId]);
  if (sources.length) {
    await database.query(`
      INSERT INTO public.quiz_sources (quiz_id, group_id, position, question_percentage, question_count)
      SELECT $1, group_id, position, question_percentage, question_count
      FROM jsonb_to_recordset($2::jsonb) AS input(group_id uuid, position integer, question_percentage numeric, question_count integer)
      ORDER BY group_id
    `, [quizId, JSON.stringify(sources)]);
  }
  return (await listQuizSources(database, quizId, userId, {
    limit: 1000, offset: 0, sortBy: 'position', sortOrder: 'asc',
  })).sources;
}
