import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

export async function getMyVideosInternal({ query: queryParams }, actorUserId = null) {
  try {
    const userId = actorUserId || null;
    if (!userId) throw new HttpError(401, { message: 'Unauthorized' });

    const page = Math.max(parseInt(queryParams.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(queryParams.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const sortByRaw = String(queryParams.sort_by || 'created_at').toLowerCase();
    const sortDirRaw = String(queryParams.sort_dir || 'desc').toLowerCase();

    // whitelist: samo ove kolone smeju u ORDER BY
    const SORT_BY_MAP = {
      created_at: 'created_at',
      date: 'created_at',
      view_count: 'view_count',
      views: 'view_count',
      like_count: 'like_count',
      likes: 'like_count',
      visibility: 'visibility',
    };

    const sortBy = SORT_BY_MAP[sortByRaw] || SORT_BY_MAP.created_at;
    const sortDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC';

    // total count
    const countRes = await writePool.query(
      `SELECT COUNT(*)::int AS total
       FROM public.videos
       WHERE uploaded_by = $1`,
      [userId],
    );
    const total = countRes.rows[0]?.total || 0;

    // paged rows
    const { rows } = await writePool.query(
      `
      SELECT
        id,
        title,
        description,
        thumbnail_url,
        duration_seconds,
        view_count,
        like_count,
        dislike_count,
        created_at,
        visibility
      FROM public.videos
      WHERE uploaded_by = $1
      ORDER BY ${sortBy} ${sortDir}, id DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset],
    );

    return {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      sort_by: sortByRaw,
      sort_dir: sortDirRaw,
      videos: rows,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('my videos route error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
