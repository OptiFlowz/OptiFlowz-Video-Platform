import { writePool } from '../../../database/index.js';
import * as muxService from '../mux.service.js';

export async function updateVideoFromMuxWebhookInternal(uploadId, muxData) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');

    // 1) Nađi video: prvo po uploadId (ako postoji), inače po assetId
    let videoRow;
    if (uploadId) {
      const { rows } = await client.query(
        `SELECT id FROM videos WHERE mux_upload_id = $1 LIMIT 1`,
        [uploadId],
      );
      videoRow = rows[0];
    }
    if (!videoRow && muxData?.assetId) {
      const { rows } = await client.query(`SELECT id FROM videos WHERE mux_asset_id = $1 LIMIT 1`, [
        muxData.assetId,
      ]);
      videoRow = rows[0];
    }
    if (!videoRow) {
      throw new Error(
        `Video with uploadId=${uploadId ?? '∅'} or assetId=${muxData?.assetId ?? '∅'} not found`,
      );
    }

    const videoId = videoRow.id;

    // 2) Normalizuj asset info
    let assetInfo = null;
    if (muxData?.assetId) {
      assetInfo = await muxService.getAssetInfo(muxData.assetId).catch(() => null);
    }
    // Izvuci playbackId: iz assetInfo ili direktno iz webhooks payload-a
    const playbackId =
      assetInfo?.playbackId ||
      assetInfo?.playback_ids?.[0]?.id || // ako tvoj muxService vraća originalni Mux oblik
      muxData?.playbackIds?.[0]?.id ||
      null;

    // 3) Grananje po eventu
    if (muxData.event === 'asset_created') {
      const duration = Math.floor(assetInfo?.duration ?? 0);

      await client.query(
        `
        UPDATE videos
        SET mux_asset_id = $1,
            mux_status  = $2,
            duration_seconds = $3,
            updated_at = NOW()
        WHERE id = $4
        `,
        [muxData.assetId, 'processing', duration, videoId],
      );
    } else if (muxData.event === 'asset_ready') {
      const duration = Math.floor(assetInfo?.duration ?? 0);
      // thumbnail: probaj pomoću playbackId; ako ga nema, probaj assetId
      const thumbSource = playbackId || muxData.assetId;
      const thumbnailUrl = thumbSource ? muxService.getThumbnailUrl(thumbSource) : null;

      await client.query(
        `
        UPDATE videos
        SET mux_asset_id    = COALESCE(mux_asset_id, $1),
            mux_playback_id = COALESCE($2, mux_playback_id),
            mux_status      = 'ready',
            thumbnail_url   = COALESCE($3, thumbnail_url),
            duration_seconds= CASE WHEN $4 IS NOT NULL AND $4 > 0 THEN $4 ELSE duration_seconds END,
            updated_at      = NOW()
        WHERE id = $5
        `,
        [muxData.assetId ?? null, playbackId, thumbnailUrl, duration || null, videoId],
      );
    } else if (muxData.event === 'asset_error') {
      await client.query(
        `
        UPDATE videos
        SET mux_status = 'error',
            updated_at = NOW()
        WHERE id = $1
        `,
        [videoId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Video webhook update failed:', err);
    throw err;
  } finally {
    client.release();
  }
}
