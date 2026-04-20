import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    q: z.string().trim().min(1, 'Missing query param: q'),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    page: z.coerce.number().int().min(1).optional().default(1),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function searchPeopleInternal(object) {
  const { q, limit, page } = prerequisites(object);
  const offset = (page - 1) * limit;

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

  const { rows } = await readPool.query(sql, [q, limit, offset]);

  const total = rows.length ? Number(rows[0].total_results) : 0;
  const totalPages = Math.ceil(total / limit);

  const people = rows.map(({ total_results, ...rest }) => rest);

  return {
    people,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}