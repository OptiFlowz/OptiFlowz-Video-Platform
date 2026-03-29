import { readPool } from '../../database/index.js';

export async function getPersonById(id) {
  const query = `
    SELECT * FROM public.people
    WHERE id = $1
  `;

  const person = (await readPool.query(query, [id])).rows[0] || null;
  return { person };
}

export async function searchPeople({ q, limit = 20, page = 1 }) {
  const query = (q ?? '').toString().trim();
  if (!query) {
    const error = new Error('Missing query param: q');
    error.status = 400;
    throw error;
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10), 1), 50);
  const safePage = Math.max(parseInt(page, 10), 1);
  const offset = (safePage - 1) * safeLimit;

  const sql = `
WITH ranked_people AS (
  SELECT
    p.id,
    p.name,
    p.image_url,
    p.description,
    ts_rank(
      p.search_vector,
      websearch_to_tsquery('simple', unaccent($1))
    ) AS rank
  FROM people p
  WHERE
    p.search_vector @@ websearch_to_tsquery('simple', unaccent($1))
    OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower($1)) || '%'
),
people_with_counts AS (
  SELECT
    rp.id,
    rp.name,
    rp.image_url,
    rp.description,
    COUNT(DISTINCT vc.video_id) FILTER (WHERE v.mux_status = 'ready') AS total_video_count,
    rp.rank
  FROM ranked_people rp
  LEFT JOIN video_chairs vc ON vc.person_id = rp.id
  LEFT JOIN videos v ON v.id = vc.video_id
  GROUP BY rp.id, rp.name, rp.image_url, rp.description, rp.rank
)
SELECT
  id,
  name,
  image_url,
  description,
  total_video_count,
  COUNT(*) OVER() AS total_results
FROM people_with_counts
ORDER BY rank DESC, total_video_count DESC, name ASC
LIMIT $2 OFFSET $3;
  `;

  const { rows } = await readPool.query(sql, [query, safeLimit, offset]);
  const totalResults = rows.length ? Number(rows[0].total_results) : 0;
  const items = rows.map(({ total_results, ...rest }) => rest);

  return {
    people: items,
    pagination: {
      total: totalResults,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(totalResults / safeLimit),
    },
  };
}
