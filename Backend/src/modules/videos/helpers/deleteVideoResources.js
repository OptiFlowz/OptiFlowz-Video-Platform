import Mux from '@mux/mux-node';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../../storage/r2.client.js';

const mux = new Mux();
const requestOptions = { maxRetries: 0, timeout: 10000 };

async function allowMissing(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

// Callers authorize video deletion; live stream deletion additionally checks ownership here.
export async function deleteVideoResources({ videoId, liveStreamId, ownerId }) {
  const deletingLiveStream = liveStreamId !== undefined;
  const { rows } = await writePool.query(
    deletingLiveStream
      ? `SELECT ls.id AS live_stream_id, ls.mux_live_stream_id,
           ARRAY(SELECT v.mux_asset_id FROM public.videos v
             WHERE v.live_stream_id=ls.id AND v.mux_asset_id IS NOT NULL) AS mux_asset_ids
         FROM public.live_streams ls WHERE ls.id=$1 AND ls.user_id=$2 LIMIT 1`
      : `SELECT v.id AS video_id, v.mux_asset_id, v.live_stream_id
         FROM public.videos v WHERE v.id = $1 LIMIT 1`,
    deletingLiveStream ? [liveStreamId, ownerId] : [videoId],
  );
  const video = rows[0];
  if (!video) {
    throw new HttpError(404, { message: deletingLiveStream ? 'Live stream not found' : 'Video not found' });
  }
  if (!video.mux_asset_id && !video.mux_live_stream_id) {
    throw new HttpError(400, { message: 'Video has no mux_asset_id' });
  }

  const assetIds = new Set(deletingLiveStream ? video.mux_asset_ids : (video.mux_asset_id ? [video.mux_asset_id] : []));
  let operation = 'retrieve live stream';
  const startedAt = Date.now();
  try {
    if (video.mux_live_stream_id) {
      const id = video.mux_live_stream_id;
      const stream = await allowMissing(() => mux.video.liveStreams.retrieve(id, requestOptions));
      if (stream?.active_asset_id) assetIds.add(stream.active_asset_id);
      for (const assetId of stream?.recent_asset_ids ?? []) assetIds.add(assetId);

      // Stop ingest before deleting recordings, including ones whose webhooks have not arrived.
      operation = 'disable live stream';
      await allowMissing(() => mux.video.liveStreams.disable(id, requestOptions));
      // Collect every page before deleting assets so pagination cannot skip recordings.
      // SDK 12.x auto-pagination increments `page`, but Mux may ignore that
      // parameter and return the same nonempty page forever. Use next_cursor.
      operation = 'list recordings';
      let cursor;
      const cursors = new Set();
      do {
        const response = await mux.video.assets.list({
          live_stream_id: id, limit: 100, ...(cursor ? { cursor } : {}),
        }, requestOptions).asResponse();
        const page = await response.json();
        if (!Array.isArray(page.data)) throw new Error('Invalid asset list response');
        for (const asset of page.data) assetIds.add(asset.id);
        cursor = page.next_cursor;
        if (cursor != null && (typeof cursor !== 'string' || !cursor || cursors.has(cursor))) {
          throw new Error('Invalid or repeated asset list cursor');
        }
        if (cursor) cursors.add(cursor);
      } while (cursor);
    }

    operation = 'delete recording';
    for (const assetId of assetIds) {
      // An accepted DELETE (204) is sufficient; do not poll for asynchronous
      // removal or wait for video.asset.deleted before replying to the caller.
      await allowMissing(() => mux.video.assets.delete(assetId, requestOptions));
    }
    if (video.mux_live_stream_id) {
      operation = 'delete live stream';
      await allowMissing(() => mux.video.liveStreams.delete(video.mux_live_stream_id, requestOptions));
    }
  } catch (error) {
    // Preserve local IDs on upstream failure so another DELETE can retry cleanup.
    // Mux response bodies can contain encoder credentials; do not expose them.
    console.error('[Mux deletion failed]', {
      operation, video_id: video.video_id, live_stream_id: video.live_stream_id,
      status: Number.isInteger(error.status) ? error.status : null,
      elapsed_ms: Date.now() - startedAt,
    });
    throw new HttpError(502, { message: 'Unable to delete video resources from Mux' });
  }

  // Parent deletion cascades to every recording and its dependent records.
  // Do not wait for a webhook: an already missing Mux asset will not emit a new one.
  if (deletingLiveStream) {
    const client = await writePool.connect();
    try {
      await client.query('BEGIN');
      // Match the webhook/upload lock order and collect the latest thumbnails,
      // including recordings created while Mux deletion was in progress.
      const live = await client.query(`SELECT id, thumbnail_url FROM public.live_streams
        WHERE id=$1 FOR UPDATE`, [video.live_stream_id]);
      const recordings = await client.query(`SELECT id, thumbnail_url FROM public.videos
        WHERE live_stream_id=$1 FOR UPDATE`, [video.live_stream_id]);
      const baseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
      const bucket = process.env.R2_BUCKET;
      const thumbnails = [...live.rows, ...recordings.rows].filter(row => row.thumbnail_url);
      if (thumbnails.length && (!baseUrl || !bucket)) {
        throw new HttpError(500, { message: 'R2 storage is not configured' });
      }
      const keys = new Set();
      for (const row of thumbnails) {
        if (row.thumbnail_url.startsWith(`${baseUrl}/live-stream-thumbnails/${video.live_stream_id}/`)
            || row.thumbnail_url.startsWith(`${baseUrl}/video-thumbnails/${row.id}/`)) {
          keys.add(row.thumbnail_url.slice(baseUrl.length + 1));
        }
      }
      for (const key of keys) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }),
            { abortSignal: AbortSignal.timeout(10000) });
        } catch (error) {
          if (error.$metadata?.httpStatusCode !== 404 && error.name !== 'NoSuchKey') {
            throw new HttpError(502, { message: 'Unable to delete livestream thumbnails from R2' });
          }
        }
      }
      await client.query('DELETE FROM public.live_streams WHERE id = $1', [video.live_stream_id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  } else if (video.live_stream_id) {
    // Keep a tombstone on the parent to stop delayed asset webhooks recreating
    // an explicitly deleted recording. Lock the parent before deleting the child.
    await writePool.query(`WITH tombstone AS (
      UPDATE public.live_streams SET mux_deleted_asset_ids =
        ARRAY(SELECT DISTINCT unnest(array_append(mux_deleted_asset_ids, $3::text)))
      WHERE id=$2 RETURNING id
    ) DELETE FROM public.videos WHERE id=$1 AND live_stream_id IN (SELECT id FROM tombstone)`,
    [video.video_id, video.live_stream_id, video.mux_asset_id]);
  } else {
    await writePool.query('DELETE FROM public.videos WHERE id = $1', [video.video_id]);
  }
  return {
    success: true,
    ...(deletingLiveStream ? {} : { video_id: video.video_id, mux_asset_id: video.mux_asset_id }),
    ...(video.live_stream_id ? { live_stream_id: video.live_stream_id } : {}),
    message: deletingLiveStream ? 'Live stream and recordings deleted.' : 'Video deleted.',
  };
}
