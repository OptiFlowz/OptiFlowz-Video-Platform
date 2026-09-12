import 'dotenv/config';
import { writePool, readPool } from '../database/index.js';
import { transaction, scheduleOverview } from '../modules/video-indexing/indexing.service.js';
import { reconcileTracks } from '../modules/video-indexing/mux-source.service.js';

// Enqueue only. The separate worker performs all paid embedding requests.
const force = process.argv.includes('--force');
let cursor = null;
let scheduled = 0;
try {
  while (true) {
    const { rows } = await writePool.query(
      `SELECT id,mux_asset_id FROM videos
      WHERE ($1::uuid IS NULL OR id>$1) AND mux_status IS DISTINCT FROM 'deleted'
      ORDER BY id LIMIT 100`,
      [cursor],
    );
    if (!rows.length) break;
    for (const video of rows) {
      try {
        await transaction(async (client) => {
          await client.query('SELECT id FROM videos WHERE id=$1 FOR UPDATE', [video.id]);
          const existing = await client.query(
            `SELECT id FROM video_indexing_sources
            WHERE video_id=$1 AND document_type='overview'`,
            [video.id],
          );
          if (force || !existing.rowCount) await scheduleOverview(client, video.id);
        });
        if (video.mux_asset_id) await reconcileTracks(video.mux_asset_id, video.id, { force });
        scheduled++;
      } catch (error) {
        process.exitCode = 1;
        console.error(`[video-indexing] video=${video.id}: ${error.message}`);
      }
    }
    cursor = rows.at(-1).id;
  }
  console.log(`[video-indexing] checked ${scheduled} videos`);
} finally {
  await Promise.all([writePool.end(), readPool.end()]);
}
