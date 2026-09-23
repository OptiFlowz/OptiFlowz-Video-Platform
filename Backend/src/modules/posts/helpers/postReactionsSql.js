// Expressions come only from internal callers, never request data.
// Counts are stored on posts; only the viewer's reaction needs a lookup.
export function postReactionsSql(viewerExpression = 'NULL::uuid', postAlias = 'p') {
  return `jsonb_build_object(
    'like_count', ${postAlias}.like_count,
    'dislike_count', ${postAlias}.dislike_count,
    'user_reaction', COALESCE((SELECT r.reaction FROM public.post_reactions r
      WHERE r.post_id = ${postAlias}.id AND r.user_id = ${viewerExpression}), 0)
  )`;
}
