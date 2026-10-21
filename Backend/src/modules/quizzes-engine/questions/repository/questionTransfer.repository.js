export async function findImportCategory(database, userId, name) {
  const { rows } = await database.query('SELECT id FROM public.question_categories WHERE user_id=$1 AND name=$2 FOR SHARE', [userId, name]);
  return rows[0]?.id;
}
export async function createImportCategory(database, userId, name) {
  // A concurrent category POST can create the same name; reuse it without changing its data.
  const { rows } = await database.query(`INSERT INTO public.question_categories(user_id,name)
    VALUES ($1,$2) ON CONFLICT (user_id,name) DO NOTHING RETURNING id`, [userId,name]);
  return rows[0]?.id ?? await findImportCategory(database, userId, name);
}
export async function getExportQuestions(database, userId, filters) {
  const { rows } = await database.query(`SELECT q.id, q.type, q.content, q.explanation,
    q.max_points::double precision AS max_points,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'name',c.name) END AS category,
    COALESCE((SELECT jsonb_agg(to_jsonb(o)-'question_id' ORDER BY o.position,o.option_no)
      FROM public.question_options o WHERE o.question_id=q.id),'[]'::jsonb) AS options,
    COALESCE((SELECT jsonb_agg(to_jsonb(o)-'question_id' ORDER BY o.position,o.option_no)
      FROM public.question_matching_options o WHERE o.question_id=q.id),'[]'::jsonb) AS matching_options,
    COALESCE((SELECT jsonb_agg(to_jsonb(i)-'question_id' ORDER BY i.position,i.item_no)
      FROM public.question_matching_items i WHERE i.question_id=q.id),'[]'::jsonb) AS matching_items
    FROM public.questions q LEFT JOIN public.question_categories c ON c.id=q.category_id
    WHERE q.user_id=$1 AND ($2::uuid IS NULL OR q.category_id=$2)
      AND ($3::public.question_type IS NULL OR q.type=$3)
      AND ($4::uuid[] IS NULL OR q.id=ANY($4::uuid[]))
    ORDER BY c.name NULLS FIRST,q.created_at,q.id LIMIT 1001`,
  [userId, filters.category_id ?? null, filters.type ?? null, filters.question_ids ?? null]);
  return rows;
}
