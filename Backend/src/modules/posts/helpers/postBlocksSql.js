// The outer post must use alias p. Pass only a trusted SQL expression for
// correctness visibility, never request data. Public feeds use the false default.
export function postBlocksSql(correctnessCondition = 'FALSE') {
  return `COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', b.id, 'post_id', b.post_id, 'type', b.type,
        'position', b.position, 'content', b.content
      ) || CASE
        WHEN b.type = 'poll' THEN jsonb_build_object('options', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', o.id, 'block_id', o.block_id, 'text', o.text, 'image_url', o.image_url
          ) ORDER BY o.id)
          FROM public.poll_options o WHERE o.block_id = b.id
        ), '[]'::jsonb))
        WHEN b.type = 'questioner' THEN jsonb_build_object('options', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', o.id, 'block_id', o.block_id, 'text', o.text, 'image_url', o.image_url
            ) || CASE WHEN ${correctnessCondition}
              THEN jsonb_build_object('is_correct', o.is_correct)
              ELSE '{}'::jsonb
            END
            ORDER BY o.id
          )
          FROM public.questioner_options o WHERE o.block_id = b.id
        ), '[]'::jsonb))
        ELSE '{}'::jsonb
      END
      ORDER BY b.position, b.id
    )
    FROM public.post_blocks b WHERE b.post_id = p.id
  ), '[]'::jsonb)`;
}
