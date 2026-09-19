// The outer post must use alias p. Pass only a trusted viewer parameter
// expression, never request data. Questioner options include correctness for instant feedback.
export function postBlocksSql(viewerExpression = 'NULL::uuid') {
  return `COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', b.id, 'post_id', b.post_id, 'type', b.type,
        'position', b.position, 'content', b.content,
        'has_responses', CASE
          WHEN b.type = 'poll' THEN EXISTS (SELECT 1 FROM public.poll_votes r JOIN public.poll_options o ON o.id = r.option_id WHERE o.block_id = b.id)
          WHEN b.type = 'questioner' THEN EXISTS (SELECT 1 FROM public.questioner_answers r JOIN public.questioner_options o ON o.id = r.option_id WHERE o.block_id = b.id)
          ELSE FALSE END
      ) || CASE
        WHEN b.type = 'poll' THEN ${participationSql('poll', viewerExpression)}
        WHEN b.type = 'questioner' THEN ${participationSql('questioner', viewerExpression)}
        ELSE '{}'::jsonb
      END
      ORDER BY b.position, b.id
    )
    FROM public.post_blocks b WHERE b.post_id = p.id
  ), '[]'::jsonb)`;
}

// Both feed and details embed participation in the same query/snapshot as blocks.
// Table names and SQL expressions come only from internal callers.
function participationSql(type, viewerExpression) {
  const questioner = type === 'questioner';
  const optionsTable = questioner ? 'questioner_options' : 'poll_options';
  const responsesTable = questioner ? 'questioner_answers' : 'poll_votes';
  const countKey = questioner ? 'answer_count' : 'vote_count';
  const totalKey = questioner ? 'total_answers' : 'total_votes';
  return `(WITH selection AS (
    SELECT ARRAY(SELECT r.option_id
      FROM public.${responsesTable} r
      JOIN public.${optionsTable} o ON o.id = r.option_id
      WHERE o.block_id = b.id AND r.user_id = ${viewerExpression}
      ORDER BY r.option_id) AS option_ids
  ), choices AS (
    SELECT o.*, selection.option_ids AS selected_option_ids,
      COUNT(r.user_id)::int AS response_count
    FROM public.${optionsTable} o CROSS JOIN selection
    LEFT JOIN public.${responsesTable} r
      ON r.option_id = o.id
    WHERE o.block_id = b.id
    GROUP BY o.id, selection.option_ids
  ), totals AS (
    SELECT *, SUM(response_count) OVER () AS total FROM choices
  )
  SELECT jsonb_build_object(
    'selected_option_id', (SELECT CASE WHEN cardinality(option_ids) = 1 THEN option_ids[1] ELSE NULL END FROM selection),
    'selected_option_ids', (SELECT option_ids FROM selection),
    'options', COALESCE(jsonb_agg(
      jsonb_build_object('id', id, 'block_id', block_id, 'text', text,
        'image_url', image_url, 'is_selected', id = ANY(selected_option_ids),
        '${countKey}', response_count)
      ${questioner ? `|| jsonb_build_object('is_correct', is_correct)` : ''}
      ORDER BY id
    ), '[]'::jsonb)
  ) || jsonb_build_object('${totalKey}', COALESCE(MAX(total), 0))
      ${questioner ? `|| jsonb_build_object(
        'correct_option_ids', COALESCE(jsonb_agg(id ORDER BY id) FILTER (WHERE is_correct), '[]'::jsonb)
      ) || CASE WHEN (SELECT cardinality(option_ids) FROM selection) > 0 THEN jsonb_build_object(
        'is_correct', COALESCE(BOOL_AND(is_correct = (id = ANY(selected_option_ids))), FALSE)
      ) ELSE '{}'::jsonb END` : ''}
  FROM totals)`;
}
