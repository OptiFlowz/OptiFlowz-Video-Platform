import { readPool } from '../../../database/index.js';

export async function searchVideosInternal(searchParams, userId = null) {
  const {
    query: searchQuery,
    category,
    tags,
    limit = 20,
    offset = 0,
    sortBy = 'relevance',
    person,
  } = searchParams;

  const params = [];
  let paramCount = 0;

  // Ako postoji userId, stavljamo ga kao prvi parametar (da ga koristimo u JOIN-u)
  let userIdParam = null;
  if (userId) {
    paramCount++;
    params.push(userId);
    userIdParam = paramCount; // npr. $1
  }

  let query = `
    SELECT 
      v.id,
      v.title,
      v.thumbnail_url,
      v.duration_seconds,
      v.view_count,
      v.created_at,
      u.full_name AS uploader_name,
      COALESCE(ppl.people, '[]'::json) AS people
      ${userId ? `, wp.progress_seconds, wp.percentage_watched` : ``}
  `;

  // Relevance scoring kada postoji searchQuery
  let searchParam = null;
  if (searchQuery && searchQuery.trim().length > 0) {
    const trimmedQuery = searchQuery.trim();
    paramCount++;
    params.push(trimmedQuery);
    searchParam = paramCount; // ako userId postoji -> $2, inače -> $1

    query += `,
      GREATEST(
        COALESCE(ts_rank(v.search_vector, plainto_tsquery('english', $${searchParam})) * 2, 0),
        similarity(v.title, $${searchParam}) * 1.5,
        similarity(COALESCE(v.description, ''), $${searchParam}),
        CASE 
          WHEN LOWER(v.title) LIKE LOWER($${searchParam}) || '%' THEN 3.0
          WHEN LOWER(v.title) LIKE '%' || LOWER($${searchParam}) || '%' THEN 2.5
          ELSE 0
        END
      ) AS relevance
    `;
  }

  query += `
    FROM videos v
    LEFT JOIN users u ON v.uploaded_by = u.id
    ${userId ? `LEFT JOIN watch_progress wp ON v.id = wp.video_id AND wp.user_id = $${userIdParam}` : ``}
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'id', p.id,
          'name', p.name,
          'image_url', p.image_url
        )
        ORDER BY p.name
      ) AS people
      FROM (
        SELECT DISTINCT p.id, p.name, p.image_url
        FROM video_chairs vc
        JOIN people p ON p.id = vc.person_id
        WHERE vc.video_id = v.id
      ) p
    ) ppl ON TRUE
    WHERE v.mux_status = 'ready' AND v.visibility = 'public'
      AND v.published_at IS NOT NULL
  `;

  // Enhanced search filter
  if (searchParam) {
    query += ` AND (
      v.search_vector @@ plainto_tsquery('english', $${searchParam})
      OR similarity(v.title, $${searchParam}) > 0.1
      OR similarity(COALESCE(v.description, ''), $${searchParam}) > 0.1
      OR LOWER(v.title) LIKE '%' || LOWER($${searchParam}) || '%'
      OR LOWER(COALESCE(v.description, '')) LIKE '%' || LOWER($${searchParam}) || '%'
    )`;
  }

  // Category filter
  if (category) {
    paramCount++;
    params.push(category);
    query += `
      AND EXISTS (
        SELECT 1
        FROM video_categories vc
        WHERE vc.video_id = v.id
          AND vc.category_id = $${paramCount}
      )
    `;
  }

  // Tags filter
  if (tags && tags.length > 0) {
    paramCount++;
    params.push(tags);
    query += ` AND v.tags && $${paramCount}`;
  }

  // Person filter
  if (person) {
    paramCount++;
    params.push(person);
    query += ` 
      AND EXISTS (
        SELECT 1
        FROM video_chairs vc2
        WHERE vc2.video_id = v.id
          AND vc2.person_id = $${paramCount}
      )
    `;
  }

  // Sorting
  switch (sortBy) {
    case 'relevance':
      if (searchParam) query += ` ORDER BY relevance DESC, v.created_at DESC`;
      else query += ` ORDER BY v.created_at DESC`;
      break;
    case 'date':
      query += ` ORDER BY v.created_at DESC`;
      break;
    case 'views':
      query += ` ORDER BY v.view_count DESC`;
      break;
    case 'likes':
      query += ` ORDER BY v.like_count DESC`;
      break;
    default:
      query += ` ORDER BY v.created_at DESC`;
  }

  // Pagination
  paramCount++;
  params.push(limit);
  query += ` LIMIT $${paramCount}`;

  paramCount++;
  params.push(offset);
  query += ` OFFSET $${paramCount}`;

  const { rows } = await readPool.query(query, params);

  // Count query (ne treba watch_progress)
  let countQuery = `
    SELECT COUNT(*) AS total
    FROM videos v
    WHERE v.mux_status = 'ready' AND v.visibility = 'public'
      AND v.published_at IS NOT NULL
  `;

  const countParams = [];
  let countParamNum = 0;

  if (searchQuery && searchQuery.trim().length > 0) {
    countParamNum++;
    countParams.push(searchQuery.trim());
    countQuery += ` AND (
      v.search_vector @@ plainto_tsquery('english', $${countParamNum})
      OR similarity(v.title, $${countParamNum}) > 0.1
      OR similarity(COALESCE(v.description, ''), $${countParamNum}) > 0.1
      OR LOWER(v.title) LIKE '%' || LOWER($${countParamNum}) || '%'
      OR LOWER(COALESCE(v.description, '')) LIKE '%' || LOWER($${countParamNum}) || '%'
    )`;
  }

  if (category) {
    countParamNum++;
    countParams.push(category);
    countQuery += `
      AND EXISTS (
        SELECT 1
        FROM video_categories vc
        WHERE vc.video_id = v.id
          AND vc.category_id = $${countParamNum}
      )
    `;
  }

  if (tags && tags.length > 0) {
    countParamNum++;
    countParams.push(tags);
    countQuery += ` AND v.tags && $${countParamNum}`;
  }

  if (person) {
    countParamNum++;
    countParams.push(person);
    countQuery += ` 
      AND EXISTS (
        SELECT 1
        FROM video_chairs vc2
        WHERE vc2.video_id = v.id
          AND vc2.person_id = $${countParamNum}
      )
    `;
  }

  const { rows: countRows } = await readPool.query(countQuery, countParams);

  return {
    videos: rows,
    total: parseInt(countRows[0].total, 10),
    limit,
    offset,
  };
}
