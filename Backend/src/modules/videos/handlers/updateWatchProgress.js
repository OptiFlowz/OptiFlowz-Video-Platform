import { writePool } from '../../../database/index.js';

export async function updateWatchProgressInternal(videoId, userId, progressSeconds) {
  const query = `
    INSERT INTO watch_progress (
      user_id, video_id, progress_seconds, percentage_watched, last_watched_at
    )
    SELECT
      $1::uuid,
      $2::uuid,
      CASE
        WHEN v.duration_seconds > 0
          THEN LEAST(GREATEST($3::int, 0), v.duration_seconds)
        ELSE GREATEST($3::int, 0)
      END AS progress_seconds,
      CASE
        WHEN v.duration_seconds > 0 THEN
          LEAST(
            100,
            ROUND( (LEAST(GREATEST($4::numeric, 0), v.duration_seconds::numeric)
                   / v.duration_seconds::numeric) * 100, 2 )
          )
        ELSE 0
      END AS percentage_watched,
      NOW()
    FROM videos v
    WHERE v.id = $2::uuid
    ON CONFLICT (user_id, video_id)
    DO UPDATE SET
      progress_seconds = CASE
        WHEN (SELECT duration_seconds FROM videos WHERE id = watch_progress.video_id) > 0
          THEN LEAST(
                 EXCLUDED.progress_seconds,
                 (SELECT duration_seconds FROM videos WHERE id = watch_progress.video_id)
               )
        ELSE EXCLUDED.progress_seconds
      END,
      percentage_watched = CASE
        WHEN (SELECT duration_seconds FROM videos WHERE id = watch_progress.video_id) > 0
          THEN LEAST(
                 100,
                 ROUND(
                   (EXCLUDED.progress_seconds::numeric
                    / (SELECT duration_seconds::numeric FROM videos WHERE id = watch_progress.video_id)) * 100,
                   2
                 )
               )
        ELSE 0
      END,
      last_watched_at = NOW();
  `;

  // $1=userId, $2=videoId, $3=progressSeconds (int), $4=progressSeconds (numeric)
  await writePool.query(query, [userId, videoId, progressSeconds, progressSeconds]);
}
