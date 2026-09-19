import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { postUserIdSchema, publicPostsQuerySchema, PUBLIC_POST_SORT_FIELDS } from '../helpers/posts.shared.js';
import { postBlocksSql } from '../helpers/postBlocksSql.js';

export async function getUserPostsInternal(params, query) {
  const { userId } = validateOrThrow(postUserIdSchema.safeParse(params));
  const { page, limit, sortBy, sortOrder } = validateOrThrow(publicPostsQuerySchema.safeParse(query));
  const offset = (page - 1) * limit;
  const direction = sortOrder.toUpperCase();
  const orderBy = `${PUBLIC_POST_SORT_FIELDS[sortBy]} ${direction}, id ${direction}`;

  // Filter and paginate posts before loading their blocks. The total and nested
  // results use one primary-database snapshot and always exclude private posts.
  const { rows } = await writePool.query(
    `WITH page_posts AS (
       SELECT id, user_id, title, status, created_at FROM public.posts
       WHERE user_id = $1 AND status = 'public'
       ORDER BY ${orderBy} LIMIT $2 OFFSET $3
     )
     SELECT
       (SELECT COUNT(*)::int FROM public.posts WHERE user_id = $1 AND status = 'public') AS total,
       COALESCE((
         SELECT jsonb_agg(
           to_jsonb(p) || jsonb_build_object('blocks', ${postBlocksSql()})
           ORDER BY ${orderBy}
         )
         FROM page_posts p
       ), '[]'::jsonb) AS posts`,
    [userId, limit, offset],
  );
  const { posts, total } = rows[0];
  const totalPages = Math.ceil(total / limit);
  return {
    posts,
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
