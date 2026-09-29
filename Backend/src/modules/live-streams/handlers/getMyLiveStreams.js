import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';

const sortColumns = {
  created_at: 'created_at', scheduled_at: 'scheduled_at', started_at: 'started_at',
  updated_at: 'updated_at', title: 'title', status: 'status', visibility: 'visibility',
};
const querySchema = z.object({
  page: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.enum(['new', 'old']).optional(),
  sort_by: z.enum(Object.keys(sortColumns)).default('created_at'),
  sort_dir: z.enum(['asc', 'desc']).optional(),
});

export async function getMyLiveStreamsInternal({ query = {} }, userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
  const { page, limit, sort, sort_by, sort_dir } = validateOrThrow(querySchema.safeParse(query));
  const direction = sort_dir ?? (sort === 'old' ? 'asc' : 'desc');
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw new HttpError(400, { message: 'Page is too large' });

  const count = await writePool.query(`SELECT COUNT(*)::int AS total
    FROM public.live_streams WHERE user_id=$1`, [userId]);
  const total = count.rows[0]?.total ?? 0;
  const { rows } = await writePool.query(`SELECT
      id, user_id, title, description, thumbnail_url, status, mux_status,
      visibility, playback_policy, dvr_enabled, scheduled_at, started_at,
      ended_at, connected_at, disconnected_at, completed_at, created_at, updated_at
    FROM public.live_streams WHERE user_id=$1
    ORDER BY ${sortColumns[sort_by]} ${direction.toUpperCase()} NULLS LAST, id ${direction.toUpperCase()}
    LIMIT $2 OFFSET $3`, [userId, limit, offset]);
  return {
    live_streams: rows, page, limit, total, total_pages: Math.ceil(total / limit),
    sort_by, sort_dir: direction,
  };
}
