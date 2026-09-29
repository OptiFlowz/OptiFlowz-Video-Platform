import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { withVideoCardMedia } from '../../videos/helpers/videoCardMedia.js';

const inputSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  page: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort_by: z.enum(['streamed_at', 'views', 'view_count']).default('streamed_at'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
});

export async function getUserLiveCardsInternal({ params, query = {} }, viewerId = null) {
  const { userId, page, limit, sort_by, sort_dir } = validateOrThrow(inputSchema.safeParse({ ...query, userId: params?.userId }));
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw new HttpError(400, { message: 'Page is too large' });

  // Joining all recordings is intentional: hidden or preparing recordings must
  // not make their parent appear to be a stream with no recording.
  const source = `FROM public.live_streams ls
    LEFT JOIN public.videos v ON v.live_stream_id=ls.id
    WHERE ls.user_id=$1 AND ls.visibility='public'
      AND ((v.id IS NOT NULL AND v.visibility='public' AND v.mux_status='ready' AND v.published_at <= NOW())
        OR (v.id IS NULL AND ls.status IN ('scheduled','live')))`;
  const direction = sort_dir.toUpperCase();
  const order = `${sort_by === 'streamed_at' ? '' : `view_count ${direction}, `}sort_at ${direction}, id ${direction}, card_type ASC`;
  const [count, result] = await Promise.all([
    writePool.query(`SELECT COUNT(*)::int AS total ${source}`, [userId]),
    writePool.query(`WITH eligible AS (
      SELECT COALESCE(v.id,ls.id) AS id, v.id AS video_id, ls.id AS livestream_id,
        CASE WHEN v.id IS NOT NULL THEN 'recording' ELSE ls.status END AS card_type,
        CASE WHEN v.id IS NOT NULL THEN v.title ELSE ls.title END AS title,
        CASE WHEN v.id IS NOT NULL THEN v.description ELSE ls.description END AS description,
        CASE WHEN v.id IS NOT NULL THEN v.thumbnail_url ELSE ls.thumbnail_url END AS thumbnail_url,
        CASE WHEN v.id IS NOT NULL THEN v.uploaded_by ELSE ls.user_id END AS uploader_id,
        v.duration_seconds, COALESCE(v.view_count,0) AS view_count,
        COALESCE(v.created_at,ls.created_at) AS created_at,
        COALESCE(v.mux_recording_started_at,ls.started_at,ls.connected_at) AS streamed_at,
        COALESCE(v.mux_recording_started_at,ls.started_at,ls.connected_at,ls.scheduled_at,v.created_at,ls.created_at) AS sort_at,
        ls.status AS livestream_status, ls.scheduled_at, ls.started_at, ls.ended_at, ls.dvr_enabled,
        v.mux_recording_started_at AS recording_started_at,
        v.mux_recording_completed_at AS recording_completed_at
      ${source}
    ), paged AS (SELECT * FROM eligible ORDER BY ${order} LIMIT $2 OFFSET $3)
    SELECT c.*, u.full_name AS uploader_name, COALESCE(ppl.people,'[]'::json) AS people
      ${viewerId ? ', wp.progress_seconds, wp.percentage_watched::float AS percentage_watched' : ''}
    FROM paged c
    LEFT JOIN public.users u ON u.id=c.uploader_id
    ${viewerId ? 'LEFT JOIN public.watch_progress wp ON wp.video_id=c.video_id AND wp.user_id=$4' : ''}
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('id',p.id,'name',p.name,'image_url',p.image_url) ORDER BY p.name) AS people
      FROM (SELECT DISTINCT p.id,p.name,p.image_url FROM public.video_chairs vc
        JOIN public.people p ON p.id=vc.person_id WHERE vc.video_id=c.video_id) p
    ) ppl ON TRUE
    ORDER BY ${order}`, viewerId ? [userId, limit, offset, viewerId] : [userId, limit, offset]),
  ]);
  const rows = result.rows.map(({ sort_at, ...card }) => card);
  const recordings = await withVideoCardMedia(rows.filter(card => card.card_type === 'recording'));
  const mediaById = new Map(recordings.map(card => [card.id, card]));
  const cards = rows.map(card => card.card_type === 'recording' ? mediaById.get(card.id) : {
    ...card, mux_thumbnail_url: null, preview_url: null, media_expires_at: null,
  });
  const total = count.rows[0]?.total ?? 0;
  return { cards, page, limit, total, total_pages: Math.ceil(total / limit), sort_by, sort_dir };
}
