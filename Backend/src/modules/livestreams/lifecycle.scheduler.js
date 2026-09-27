import { writePool } from '../../database/index.js';
import { reconcileLivestream } from './lifecycle.service.js';

// The API owns this loop. A database lock prevents overlapping sweeps when
// multiple API instances are running; webhooks continue handling live events.
export function startLivestreamLifecycle({
  database = writePool,
  reconcile = reconcileLivestream,
  intervalMs = 15000,
  logger = console,
} = {}) {
  let stopped = false;
  let timer;
  let running;

  async function sweep() {
    let client;
    let locked = false;
    let releaseError;
    try {
      client = await database.connect();
      const { rows: locks } = await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended('livestream-lifecycle-sweep', 0)) AS acquired",
      );
      locked = locks[0]?.acquired === true;
      if (!locked || stopped) return;
      const { rows } = await client.query(`SELECT video_id FROM video_livestreams
        WHERE NOT policy_sync_pending AND mux_live_stream_id IS NOT NULL AND (
          (status IN ('live', 'reconnecting', 'ending')
            AND (stop_at <= NOW() OR updated_at <= NOW() - INTERVAL '15 seconds'))
          OR (status = 'ended' AND recording_finalized_at IS NULL
            AND updated_at <= NOW() - INTERVAL '15 seconds')
          OR (status = 'scheduled' AND updated_at <= NOW() - INTERVAL '5 minutes')
        )
        ORDER BY CASE WHEN status IN ('live', 'reconnecting', 'ending') THEN 0 ELSE 1 END,
          stop_at ASC NULLS LAST, updated_at ASC LIMIT 100`);
      for (const { video_id: videoId } of rows) {
        if (stopped) break;
        try { await reconcile(videoId); }
        catch (error) { logger.error('Livestream reconciliation failed', { videoId, status: error.status ?? null }); }
      }
    } catch {
      logger.error('Livestream lifecycle sweep failed');
    } finally {
      if (locked) {
        try { await client.query("SELECT pg_advisory_unlock(hashtextextended('livestream-lifecycle-sweep', 0))"); }
        catch (error) { releaseError = error; }
      }
      // Never return a connection with an unreleased session lock to the pool.
      client?.release(releaseError);
    }
  }

  function tick() {
    running = sweep().finally(() => {
      if (!stopped) {
        timer = setTimeout(tick, intervalMs);
        timer.unref();
      }
    });
  }
  tick();
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
