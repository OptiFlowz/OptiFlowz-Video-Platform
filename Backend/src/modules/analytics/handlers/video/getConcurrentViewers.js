import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';

export async function getConcurrentViewersInternal(videoId) {
  const { rows } = await writePool.query(`SELECT
    (SELECT COUNT(DISTINCT jsonb_build_array(vv.user_id,
       CASE WHEN vv.user_id IS NULL THEN vv.ip_address END,
       CASE WHEN vv.user_id IS NULL THEN vv.user_agent END))::int
     FROM video_views vv WHERE vv.video_id = l.video_id AND vv.is_playing
       AND vv.last_heartbeat_at >= NOW() - INTERVAL '30 seconds'
       AND l.status IN ('live', 'reconnecting', 'ending') AND l.stop_at > NOW()) AS concurrent_viewers
    FROM video_livestreams l WHERE l.video_id = $1`, [videoId]);
  if (!rows.length) throw new HttpError(404, { message: 'Livestream not found' });
  return { ...rows[0], heartbeat_window_seconds: 30 };
}
