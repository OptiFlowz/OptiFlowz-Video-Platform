import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    page: z.coerce.number().int().min(1).optional().default(1),
    sortBy: z.enum(['name', 'total_video_count']).optional().default('name'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  });

  return validateOrThrow(schema.safeParse(object));
}

function getOrderByClause(sortBy, sortOrder) {
  const direction = sortOrder.toUpperCase();

  const sortMap = {
    name: `name ${direction}, id ASC`,
    total_video_count: `total_video_count ${direction}, name ASC`,
  };

  return sortMap[sortBy] || `name ASC, id ASC`;
}

export async function getAllPeopleInternal(object) {
  const { limit, page, sortBy, sortOrder } = prerequisites(object);
  const offset = (page - 1) * limit;
  const orderByClause = getOrderByClause(sortBy, sortOrder);

  const sql = `
    WITH people_with_counts AS (
      SELECT
        p.id,
        p.name,
        p.image_url,
        p.description,
        COUNT(DISTINCT vc.video_id) FILTER (WHERE v.mux_status = 'ready') AS total_video_count
      FROM public.people p
      LEFT JOIN public.video_chairs vc ON vc.person_id = p.id
      LEFT JOIN public.videos v ON v.id = vc.video_id
      GROUP BY p.id, p.name, p.image_url, p.description
    )
    SELECT
      id,
      name,
      image_url,
      description,
      total_video_count,
      COUNT(*) OVER() AS total_results
    FROM people_with_counts
    ORDER BY ${orderByClause}
    LIMIT $1 OFFSET $2;
  `;

  const { rows } = await readPool.query(sql, [limit, offset]);

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
    sorting: {
      sortBy,
      sortOrder,
    },   
  };
}