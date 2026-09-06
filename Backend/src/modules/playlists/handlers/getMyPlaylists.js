import { readPool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

export async function getMyPlaylistsInternal({ query: queryParams }, actorUserId = null) {
  try {
    const userId = actorUserId || null;
    if (!userId) throw new HttpError(401, { message: 'Unauthorized' });

    const page = Math.max(parseInt(queryParams.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(queryParams.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const sort = String(queryParams.sort || 'created_at').toLowerCase();
    const order = String(queryParams.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // whitelist sort kolona (da nema SQL injection)
    const sortCol =
      sort === 'view_count'
        ? 'p.view_count'
        : sort === 'save_count'
          ? 'p.save_count'
          : 'p.created_at';

    const orderBy = `${sortCol} ${order}, p.created_at DESC`;

    const countRes = await readPool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM public.playlists p
      WHERE p.created_by = $1
      `,
      [userId],
    );
    const total = countRes.rows[0]?.total || 0;

    const { rows } = await readPool.query(
      `
      SELECT
        p.id,
        p.title,
        COALESCE(p.thumbnail_url, fv.first_video_thumbnail_url) AS thumbnail_url,
        p.view_count,
        p.save_count,
        ic.video_count,
        p.created_at,
        p.status,
        p.featured,
        p.description
      FROM public.playlists p
      LEFT JOIN LATERAL (
        SELECT v.thumbnail_url AS first_video_thumbnail_url
        FROM public.playlist_items pi2
        JOIN public.videos v ON v.id = pi2.video_id
        WHERE pi2.playlist_id = p.id
        ORDER BY pi2.position ASC
        LIMIT 1
      ) fv ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS video_count
        FROM public.playlist_items pi3
        WHERE pi3.playlist_id = p.id
      ) ic ON TRUE
      WHERE p.created_by = $1
      ORDER BY ${orderBy}
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset],
    );

    return {
      success: true,
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      sort: sortCol.replace('p.', ''),
      order: order.toLowerCase(),
      playlists: rows,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('handleGetMyPlaylists error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
