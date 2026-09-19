import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { postUserIdsSchema, publicPostsQuerySchema, PUBLIC_POST_SORT_FIELDS } from '../helpers/posts.shared.js';
import { postBlocksSql } from '../helpers/postBlocksSql.js';

export async function getUserPostsInternal(userIdOrIds, query, viewerId = null) {
  const userIds = validateOrThrow(postUserIdsSchema.safeParse(
    Array.isArray(userIdOrIds) ? userIdOrIds : [userIdOrIds],
  ));
  const { page, limit, sortBy, sortOrder } = validateOrThrow(publicPostsQuerySchema.safeParse(query));
  const offset = (page - 1) * limit;
  const direction = sortOrder.toUpperCase();
  const orderBy = `${PUBLIC_POST_SORT_FIELDS[sortBy]} ${direction}, id ${direction}`;

  // Filter and paginate posts before loading their blocks. The total and nested
  // results use one primary-database snapshot and always exclude private posts.
  const { rows } = await writePool.query(
    `WITH page_posts AS (
       SELECT p.id, p.user_id, p.title, p.status, p.created_at,
         u.full_name AS author_full_name, u.image_url AS author_image_url
       FROM public.posts p
       LEFT JOIN public.users u ON u.id = p.user_id
       WHERE p.user_id = ANY($1::uuid[]) AND p.status = 'public'
       ORDER BY ${orderBy} LIMIT $2 OFFSET $3
     )
     SELECT
       (SELECT COUNT(*)::int FROM public.posts WHERE user_id = ANY($1::uuid[]) AND status = 'public') AS total,
       COALESCE((
         SELECT jsonb_agg(
           to_jsonb(p) || jsonb_build_object('blocks', ${postBlocksSql('$4::uuid')})
           ORDER BY ${orderBy}
         )
         FROM page_posts p
       ), '[]'::jsonb) AS posts`,
    [userIds, limit, offset, viewerId],
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
