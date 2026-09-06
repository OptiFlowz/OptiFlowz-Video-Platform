import { readPool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

export async function getCommentsInternal(
  { params: routeParams, query: queryParams },
  actorUserId = null,
) {
  try {
    const user_id = actorUserId || null;
    const video_id = routeParams.id;

    if (!video_id) {
      throw new HttpError(400, { message: 'Missing video id' });
    }

    const page = Math.max(parseInt(queryParams.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(queryParams.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const sort = String(queryParams.sort || 'new').toLocaleLowerCase();
    const orderBy = sort === 'top' ? 'c.like_count DESC, c.created_at DESC' : 'c.created_at DESC';

    const countRes = await readPool.query(
      `
            SELECT COUNT(*)::int AS total
            FROM public.video_comments c
            WHERE c.video_id = $1 AND c.parent_id IS NULL AND c.is_deleted=false
            `,
      [video_id],
    );

    const total = countRes.rows[0]?.total || 0;

    const params = [video_id, user_id, limit, offset];

    const sql = `
        SELECT
            c.id,
            c.video_id,
            c.user_id,
            c.parent_id,
            CASE WHEN c.is_deleted THEN NULL ELSE c.content END AS content,
            c.like_count,
            c.dislike_count,
            c.reply_count,
            c.created_at,
            c.updated_at,
            u.full_name AS author_full_name,
            u.image_url AS author_image_url,
            cr.reaction AS my_reaction
        FROM public.video_comments c
        JOIN public.users u ON u.id = c.user_id
        LEFT JOIN public.comment_reactions cr ON cr.comment_id = c.id AND cr.user_id = $2
        WHERE c.video_id = $1 AND c.parent_id IS NULL AND c.is_deleted = false
        ORDER BY ${orderBy}
        LIMIT $3 OFFSET $4
        `;

    const commentsRes = await readPool.query(sql, params);

    return {
      comments: commentsRes.rows,
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.log(error);
    throw new HttpError(500, { message: 'Internal server error' });
  }
}
