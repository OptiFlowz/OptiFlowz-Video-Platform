import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { myPostsQuerySchema, requirePostUser } from '../helpers/posts.shared.js';
import { withPostVideoCards } from '../helpers/postVideoCards.js';
import { postReactionsSql } from '../helpers/postReactionsSql.js';

const SORT_FIELDS = {
  title: 'lower(title)',
  status: 'status',
  created_at: 'created_at',
  content: 'block_types',
};

export async function getMyPostsInternal(query, userId) {
  requirePostUser(userId);
  const { page, limit, sortBy, sortOrder, q } = validateOrThrow(myPostsQuerySchema.safeParse(query));
  const offset = (page - 1) * limit;
  // Only validated, fixed SQL expressions are interpolated. IDs break sort ties.
  const orderBy = `${SORT_FIELDS[sortBy]} ${sortOrder.toUpperCase()}, id ${sortOrder.toUpperCase()}`;
  // Use one primary-database snapshot so count and page agree, including when
  // the requested page is empty or the owner has just edited a post.
  const { rows } = await writePool.query(
    `WITH post_cards AS (
       SELECT p.id, p.title, summary.text, p.status, p.created_at, summary.block_types,
         p.like_count, p.dislike_count,
         u.full_name AS author_full_name, u.image_url AS author_image_url
       FROM public.posts p
       LEFT JOIN public.users u ON u.id = p.user_id
       CROSS JOIN LATERAL (
         SELECT
           COALESCE(string_agg(
             NULLIF(btrim(b.content->>'text'), ''), E'\\n' ORDER BY b.position, b.id
           ), '') AS text,
           COALESCE(array_agg(DISTINCT b.type ORDER BY b.type), ARRAY[]::text[]) AS block_types
         FROM public.post_blocks b WHERE b.post_id = p.id
       ) summary
       WHERE p.user_id = $1 AND ($4 = '' OR strpos(lower(p.title || E'\\n' || summary.text), lower($4)) > 0)
     )
     SELECT
       (SELECT COUNT(*)::int FROM post_cards) AS total,
       COALESCE((
         SELECT jsonb_agg(to_jsonb(post_page) || ${postReactionsSql('$1::uuid', 'post_page')}
         || jsonb_build_object(
           'video_blocks', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', b.id, 'post_id', b.post_id, 'type', b.type,
               'position', b.position, 'content', b.content
             ) ORDER BY b.position, b.id)
             FROM public.post_blocks b
             WHERE b.post_id = post_page.id AND b.type = 'video'
           ), '[]'::jsonb)
         ) ORDER BY ${orderBy})
         FROM (
           SELECT id, title, text, status, created_at, block_types,
             like_count, dislike_count,
             author_full_name, author_image_url FROM post_cards
           ORDER BY ${orderBy} LIMIT $2 OFFSET $3
         ) post_page
       ), '[]'::jsonb) AS posts`,
    [userId, limit, offset, q],
  );
  const { posts, total } = rows[0];
  const totalPages = Math.ceil(total / limit);
  return {
    posts: await withPostVideoCards(posts, userId),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    sorting: { sortBy, sortOrder },
  };
}
