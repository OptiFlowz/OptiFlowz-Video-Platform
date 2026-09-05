import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    q: z.string().trim().optional().default(''),
    role: z.string().regex(/^[1-9]\d*$/, 'Invalid role ID').refine(
      (value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= 9223372036854775807n,
      'Invalid role ID',
    ).optional(),
    sortBy: z.enum(['id', 'full_name', 'email', 'created_at', 'updated_at']).optional().default('full_name'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function searchUsersInternal(object = {}) {
  const { q, role, sortBy, sortOrder, page, limit } = prerequisites(object);
  const offset = (page - 1) * limit;
  const allowedSortFields = {
    id: 'u.id',
    full_name: 'lower(u.full_name)',
    email: 'u.email',
    created_at: 'u.created_at',
    updated_at: 'u.updated_at',
  };
  const orderByField = allowedSortFields[sortBy];
  const orderByDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';

  // Treat wildcard characters as literal search text.
  const values = q ? [`%${q.replace(/[\\%_]/g, '\\$&')}%`] : [];
  const conditions = [];
  if (q) {
    conditions.push(`(u.full_name ILIKE $1
          OR u.email::text ILIKE $1
          OR u.description ILIKE $1)`);
  }
  if (role !== undefined) {
    values.push(role);
    conditions.push(`EXISTS (
      SELECT 1
      FROM public.user_roles filter_roles
      WHERE filter_roles.user_id = u.id
        AND filter_roles.role_id = $${values.length}::bigint
        AND (filter_roles.expires_at IS NULL OR filter_roles.expires_at > now())
    )`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await readPool.query(
    `SELECT COUNT(*)::int AS total FROM public.users u ${whereClause}`,
    values,
  );
  const total = countRes.rows[0]?.total || 0;

  const { rows } = await readPool.query(
    `
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.created_at,
        u.image_url,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object('id', r.id, 'name', r.name)
              ORDER BY r.position ASC, r.id ASC
            )
            FROM public.user_roles ur
            JOIN public.roles r ON r.id = ur.role_id
            WHERE ur.user_id = u.id
              AND (ur.expires_at IS NULL OR ur.expires_at > now())
          ),
          '[]'::jsonb
        ) AS roles
      FROM public.users u
      ${whereClause}
      ORDER BY ${orderByField} ${orderByDirection}, u.id ASC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `,
    [...values, limit, offset],
  );

  const totalPages = Math.ceil(total / limit);

  return {
    users: rows,
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
