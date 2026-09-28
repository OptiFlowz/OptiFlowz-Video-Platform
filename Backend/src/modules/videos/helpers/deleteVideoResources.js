import Mux from '@mux/mux-node';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

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
    `SELECT v.id AS video_id, v.mux_asset_id,
            ls.id AS live_stream_id, ls.mux_live_stream_id
     FROM public.videos v
     LEFT JOIN public.live_streams ls ON ls.video_id = v.id
     WHERE ${deletingLiveStream ? 'ls.id = $1 AND v.uploaded_by = $2' : 'v.id = $1'}
     LIMIT 1`,
    deletingLiveStream ? [liveStreamId, ownerId] : [videoId],
  );
  const video = rows[0];
  if (!video) {
    throw new HttpError(404, { message: deletingLiveStream ? 'Live stream not found' : 'Video not found' });
  }
  if (!video.mux_asset_id && !video.mux_live_stream_id) {
    throw new HttpError(400, { message: 'Video has no mux_asset_id' });
  }

  const assetIds = new Set(video.mux_asset_id ? [video.mux_asset_id] : []);
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
      operation, video_id: video.video_id,
      status: Number.isInteger(error.status) ? error.status : null,
      elapsed_ms: Date.now() - startedAt,
    });
    throw new HttpError(502, { message: 'Unable to delete video resources from Mux' });
  }

  // Cascades to the live stream, reactions, comments and indexing records.
  // Do not wait for a webhook: an already missing Mux asset will not emit a new one.
  await writePool.query('DELETE FROM public.videos WHERE id = $1', [video.video_id]);
  return {
    success: true,
    video_id: video.video_id,
    mux_asset_id: video.mux_asset_id,
    ...(video.live_stream_id ? { live_stream_id: video.live_stream_id } : {}),
    message: video.live_stream_id ? 'Live stream and recordings deleted.' : 'Video deleted.',
  };
}
