import { writePool } from '../../../database/index.js';
import { hashIp, normalizeIp } from '../helpers/video.shared.js';

export async function heartbeatWatchDurationInternal(
  viewId,
  { seq, isPlaying = true, userId = null, ip = null, userAgent = '' },
) {
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    if (!viewId) throw new Error('Missing viewId');

    const s = Number(seq);
    if (!Number.isFinite(s) || s <= 0) throw new Error('Invalid seq');

    const hashedIp = userId ? null : hashIp(normalizeIp(ip));

    const HEARTBEAT_INTERVAL_SEC = 10;
    const MAX_DELTA_SEC = Math.floor(HEARTBEAT_INTERVAL_SEC * 1.5); // 15s

    const { rows } = await client.query(
      `
      WITH prev AS (
        SELECT id, user_id, video_id, last_heartbeat_at, last_seq, watch_duration
        FROM video_views
        WHERE id = $1
          AND (
            ($5::uuid IS NOT NULL AND user_id = $5::uuid)
            OR (
              $5::uuid IS NULL
              AND user_id IS NULL
              AND ip_address IS NOT DISTINCT FROM $6::text
              AND user_agent IS NOT DISTINCT FROM $7::text
            )
          )
        FOR UPDATE
      ),
      calc AS (
        SELECT
          id,
          last_seq,
          CASE
            WHEN $2::boolean IS TRUE THEN
              LEAST(
                GREATEST(
                  EXTRACT(EPOCH FROM (NOW() - COALESCE(last_heartbeat_at, NOW()))),
                  0
                ),
                $4::double precision
              )::bigint
            ELSE 0::bigint
          END AS delta
        FROM prev
      ),
      updated AS (
        UPDATE video_views v
        SET
          watch_duration = COALESCE(v.watch_duration, 0) + c.delta,
          last_heartbeat_at = NOW(),
          last_seq = $3::bigint
        FROM calc c
        WHERE v.id = c.id
          AND (
            c.last_seq IS NULL
            OR $3::bigint = c.last_seq + 1
          )
        RETURNING v.id, v.video_id, v.watch_duration, c.delta AS counted_delta
      )
      SELECT
        u.id,
        u.video_id,
        u.watch_duration,
        u.counted_delta,
        false AS ignored,
        false AS invalid_seq
      FROM updated u

      UNION ALL

      SELECT
        p.id,
        p.video_id,
        p.watch_duration,
        0::bigint AS counted_delta,
        true AS ignored,
        CASE
          WHEN p.last_seq IS NOT NULL AND ($3::bigint - p.last_seq) >= 2 THEN true
          ELSE false
        END AS invalid_seq
      FROM prev p
      WHERE NOT EXISTS (SELECT 1 FROM updated)
      `,
      [viewId, isPlaying, s, MAX_DELTA_SEC, userId, hashedIp, userAgent],
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return null; // view ne postoji ili nije user-ov
    }

    if (userId && rows[0].video_id && Number(rows[0].counted_delta) > 0) {
      await client.query(
        `
        INSERT INTO watch_progress (
          user_id,
          video_id,
          total_watch_seconds,
          last_watched_at
        )
        VALUES ($1::uuid, $2::uuid, $3::int, NOW())
        ON CONFLICT (user_id, video_id)
        DO UPDATE SET
          total_watch_seconds = COALESCE(watch_progress.total_watch_seconds, 0) + EXCLUDED.total_watch_seconds,
          last_watched_at = NOW()
        `,
        [userId, rows[0].video_id, Number(rows[0].counted_delta)],
      );
    }

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Heartbeat watch_duration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}
