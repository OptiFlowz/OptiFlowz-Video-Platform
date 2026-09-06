import { readPool } from '../../../database/index.js';

export async function searchPlaylistsInternal(searchParams) {
  const { query: searchQuery, tags, limit = 20, offset = 0, sortBy = 'relevance' } = searchParams;

  const params = [];
  let paramCount = 0;

  let query = `
    SELECT
      p.id,
      p.title,
      p.description,
      COALESCE(p.thumbnail_url, fv.first_video_thumbnail_url) AS thumbnail_url,
      p.view_count,
      ic.video_count,
      p.created_at
  `;

  // Relevance scoring (ako postoji q)
  let searchParam = null;
  if (searchQuery && searchQuery.trim().length > 0) {
    const trimmedQuery = searchQuery.trim();
    paramCount++;
    params.push(trimmedQuery);
    searchParam = paramCount;

    query += `,
      GREATEST(
        COALESCE(ts_rank(p.search_vector, plainto_tsquery('english', $${searchParam})) * 2, 0),
        similarity(p.title, $${searchParam}) * 1.5,
        similarity(COALESCE(p.description, ''), $${searchParam}),
        CASE
          WHEN LOWER(p.title) LIKE LOWER($${searchParam}) || '%' THEN 3.0
          WHEN LOWER(p.title) LIKE '%' || LOWER($${searchParam}) || '%' THEN 2.5
          ELSE 0
        END
      ) AS relevance
    `;
  }

  query += `
    FROM public.playlists p
    LEFT JOIN LATERAL (
      SELECT v.thumbnail_url AS first_video_thumbnail_url
      FROM public.playlist_items pi2
      JOIN public.videos v ON v.id = pi2.video_id
      WHERE pi2.playlist_id = p.id
        AND v.mux_status = 'ready'
        AND v.published_at IS NOT NULL
      ORDER BY pi2.position ASC
      LIMIT 1
    ) fv ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS video_count
      FROM public.playlist_items pi3
      JOIN public.videos v3 ON v3.id = pi3.video_id
      WHERE pi3.playlist_id = p.id
        AND v3.mux_status = 'ready'
        AND v3.published_at IS NOT NULL
    ) ic ON TRUE
    WHERE p.status = 'public'
      AND EXISTS (
        SELECT 1
        FROM public.playlist_items pi_exist
        JOIN public.videos v_exist ON v_exist.id = pi_exist.video_id
        WHERE pi_exist.playlist_id = p.id
          AND v_exist.mux_status = 'ready'
          AND v_exist.published_at IS NOT NULL
      )
  `;

  // Search filter
  if (searchParam) {
    query += ` AND (
      p.search_vector @@ plainto_tsquery('english', $${searchParam})
      OR similarity(p.title, $${searchParam}) > 0.1
      OR similarity(COALESCE(p.description, ''), $${searchParam}) > 0.1
      OR LOWER(p.title) LIKE '%' || LOWER($${searchParam}) || '%'
      OR LOWER(COALESCE(p.description, '')) LIKE '%' || LOWER($${searchParam}) || '%'
    )`;
  }

  // Tags filter (ako imaš p.tags kao text[])
  if (tags && tags.length > 0) {
    paramCount++;
    params.push(tags);
    query += ` AND p.tags && $${paramCount}`;
  }

  // Sorting
  switch (sortBy) {
    case 'relevance':
      if (searchParam) query += ` ORDER BY relevance DESC, p.created_at DESC`;
      else query += ` ORDER BY p.created_at DESC`;
      break;
    case 'date':
      query += ` ORDER BY p.created_at DESC`;
      break;
    case 'views':
      query += ` ORDER BY p.view_count DESC`;
      break;
    case 'videos':
      query += ` ORDER BY ic.video_count DESC, p.created_at DESC`;
      break;
    default:
      query += ` ORDER BY p.created_at DESC`;
  }

  // Pagination
  paramCount++;
  params.push(limit);
  query += ` LIMIT $${paramCount}`;

  paramCount++;
  params.push(offset);
  query += ` OFFSET $${paramCount}`;

  const { rows } = await readPool.query(query, params);

  // COUNT query (bez lateral joinova)
  let countQuery = `
    SELECT COUNT(*) AS total
    FROM public.playlists p
    WHERE p.status = 'public'
      AND EXISTS (
        SELECT 1
        FROM public.playlist_items pi_exist
        JOIN public.videos v_exist ON v_exist.id = pi_exist.video_id
        WHERE pi_exist.playlist_id = p.id
          AND v_exist.mux_status = 'ready'
          AND v_exist.published_at IS NOT NULL
      )
  `;

  const countParams = [];
  let countParamNum = 0;

  if (searchQuery && searchQuery.trim().length > 0) {
    countParamNum++;
    countParams.push(searchQuery.trim());
    countQuery += ` AND (
      p.search_vector @@ plainto_tsquery('english', $${countParamNum})
      OR similarity(p.title, $${countParamNum}) > 0.1
      OR similarity(COALESCE(p.description, ''), $${countParamNum}) > 0.1
      OR LOWER(p.title) LIKE '%' || LOWER($${countParamNum}) || '%'
      OR LOWER(COALESCE(p.description, '')) LIKE '%' || LOWER($${countParamNum}) || '%'
    )`;
  }

  if (tags && tags.length > 0) {
    countParamNum++;
    countParams.push(tags);
    countQuery += ` AND p.tags && $${countParamNum}`;
  }

  const { rows: countRows } = await readPool.query(countQuery, countParams);

  return {
    playlists: rows,
    total: parseInt(countRows[0]?.total ?? '0', 10),
    limit,
    offset,
  };
}
