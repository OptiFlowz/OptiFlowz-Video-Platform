import { withVideoCardMedia } from '../../helpers/videoCardMedia.js';
import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';

export async function getMyVideosInternal({ query: queryParams }, actorUserId = null) {
  try {
    const userId = actorUserId || null;
    if (!userId) throw new HttpError(401, { message: 'Unauthorized' });

    const searchQuery = queryParams.q ?? queryParams.query ?? '';
    if (typeof searchQuery !== 'string') {
      throw new HttpError(400, { message: 'Search query must be a single string value' });
    }
    const trimmedQuery = searchQuery.trim();
    const filterParams = [userId];
    let whereClause = 'uploaded_by = $1';
    if (trimmedQuery) {
      // Only letters/numbers become query terms; user punctuation cannot inject
      // tsquery operators. Prefix every term to support search-as-you-type.
      const terms = trimmedQuery.match(/[\p{L}\p{N}]+/gu) || [];
      if (terms.length) {
        filterParams.push(terms.map((term) => `${term}:*`).join(' & '));
        whereClause += " AND search_vector @@ to_tsquery('english', $2)";
      } else {
        whereClause += ' AND FALSE';
      }
    }

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
       WHERE ${whereClause}`,
      filterParams,
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
        published_at,
        visibility
      FROM public.videos
      WHERE ${whereClause}
      ORDER BY ${sortBy} ${sortDir}, id DESC
      LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}
      `,
      [...filterParams, limit, offset],
    );

    return {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      sort_by: sortByRaw,
      sort_dir: sortDirRaw,
      videos: await withVideoCardMedia(rows, actorUserId),
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('my videos route error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
