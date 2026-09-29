import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';

const idSchema = z.string().uuid('Invalid live stream ID');

export async function getLiveDetailsInternal(liveStreamId, userId = null) {
  // A guest has no personal reaction/progress; the route controls whether login is required.
  const id = validateOrThrow(idSchema.safeParse(liveStreamId));
  // Details are available before/after a broadcast; only the current unfinished
  // recording is attached. Livestream visibility governs in-progress content.
  const { rows } = await writePool.query(`SELECT
      ls.id, ls.title, ls.description, ls.thumbnail_url, ls.status, ls.mux_status,
      ls.visibility, ls.playback_policy, ls.dvr_enabled, ls.scheduled_at,
      ls.started_at, ls.ended_at, ls.connected_at, ls.disconnected_at, ls.completed_at,
      ls.created_at, ls.updated_at,
      ls.user_id AS uploader_id, u.full_name AS uploader_name, u.image_url AS uploader_image,
      recording.id AS video_id, row_to_json(recording) AS current_recording
    FROM public.live_streams ls
    LEFT JOIN public.users u ON u.id=ls.user_id
    LEFT JOIN LATERAL (
      SELECT v.id, v.live_stream_id AS livestream_id, v.title, v.description,
        v.thumbnail_url, v.mux_status, v.visibility, v.playback_policy, v.duration_seconds,
        v.view_count, v.like_count, v.dislike_count, v.created_at, v.updated_at, v.published_at,
        v.mux_recording_started_at AS recording_started_at,
        v.mux_recording_completed_at AS recording_completed_at,
        wp.progress_seconds, wp.percentage_watched::float AS percentage_watched,
        COALESCE(vr.reaction,0) AS user_reaction,
        (SELECT COUNT(*)::int FROM public.video_comments c
          LEFT JOIN public.video_comments parent ON parent.id=c.parent_id
          WHERE c.video_id=v.id AND c.is_deleted=false
            AND (c.parent_id IS NULL OR (parent.id IS NOT NULL AND parent.is_deleted=false))) AS comment_count
      FROM public.videos v
      LEFT JOIN public.watch_progress wp ON wp.video_id=v.id AND wp.user_id=$2
      LEFT JOIN public.video_reactions vr ON vr.video_id=v.id AND vr.user_id=$2
      WHERE ls.status IN ('live','disconnected') AND v.live_stream_id=ls.id
        AND v.mux_asset_id=ls.mux_active_asset_id
        AND v.mux_recording_completed_at IS NULL AND v.mux_status IS DISTINCT FROM 'deleted'
      LIMIT 1
    ) recording ON TRUE
    WHERE ls.id=$1 AND (ls.visibility IN ('public','unlisted') OR (ls.visibility='private' AND ls.user_id=$2))
    LIMIT 1`, [id, userId]);
  if (!rows[0]) throw new HttpError(404, { message: 'Live stream not found' });
  return { live_stream: rows[0] };
}
