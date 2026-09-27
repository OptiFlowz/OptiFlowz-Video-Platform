import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { buildVideoCardSelect, buildVideoCardJoins } from '../../../database/sql/videoCardFragments.js';
import { withVideoCardMedia } from '../../videos/helpers/videoCardMedia.js';

const schema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['scheduled', 'live', 'reconnecting', 'ending', 'ended', 'cancelled', 'errored']).optional(),
  channel_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

export async function listLivestreamsInternal(query, userId = null, mine = false) {
  const { q, status, channel_id, limit, page } = validateOrThrow(schema.safeParse(query));
  const { rows } = await writePool.query(
    `${buildVideoCardSelect({ includeKind: true })}, COUNT(*) OVER()::int AS total
     ${buildVideoCardJoins()}
     JOIN video_livestreams l ON l.video_id = v.id
     WHERE v.kind = 'live'
       AND (${mine ? 'v.uploaded_by = $1' : "v.visibility = 'public' AND v.published_at <= NOW()"})
       AND ($2::text IS NULL OR v.title ILIKE '%' || $2 || '%' OR v.description ILIKE '%' || $2 || '%')
       AND ($3::text IS NULL OR l.status = $3)
       AND ($4::uuid IS NULL OR v.uploaded_by = $4)
       AND ($1::uuid IS NULL OR TRUE)
     ORDER BY CASE l.status WHEN 'live' THEN 0 WHEN 'reconnecting' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
       l.scheduled_start_at ASC NULLS LAST, v.created_at DESC, v.id
     LIMIT $5 OFFSET $6`,
    [userId, q ?? null, status ?? null, channel_id ?? null, limit, (page - 1) * limit],
  );
  const total = rows[0]?.total ?? 0;
  const livestreams = await withVideoCardMedia(rows.map(({ total: _, ...row }) => row), userId, { includeLivestreams: true });
  return { livestreams, pagination: { page, limit, total } };
}
