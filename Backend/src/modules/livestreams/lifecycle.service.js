import Mux from '@mux/mux-node';
import { writePool } from '../../database/index.js';
import { reconcileTracks } from '../video-indexing/mux-source.service.js';

const mux = new Mux({ maxRetries: 0, timeout: 15000 });

// Re-read Mux state rather than trusting delivery order. An early asset.ready
// event represents a growing DVR asset, not a finalized replay.
export async function reconcileLivestream(videoId) {
  const client = await writePool.connect();
  let finalizedAsset;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT v.mux_asset_id, v.playback_policy, l.*
      FROM videos v JOIN video_livestreams l ON l.video_id = v.id
      WHERE v.id = $1 FOR UPDATE OF v, l`, [videoId]);
    const live = rows[0];
    if (!live || live.policy_sync_pending || !live.mux_live_stream_id) { await client.query('COMMIT'); return; }
    let stream;
    try { stream = await mux.video.liveStreams.retrieve(live.mux_live_stream_id); }
    catch (error) { if (error.status !== 404) throw error; }
    // One broadcast per application video. Refuse to attach a second recording.
    const unexpectedBroadcast = live.mux_asset_id && stream?.active_asset_id && live.mux_asset_id !== stream.active_asset_id;
    const expired = live.stop_at && new Date(live.stop_at).getTime() <= Date.now();
    const terminal = ['ended', 'cancelled', 'errored', 'ending'].includes(live.status);
    if (stream && (expired || terminal || unexpectedBroadcast)) {
      if (stream.status !== 'disabled') await mux.video.liveStreams.disable(stream.id);
      stream = await mux.video.liveStreams.retrieve(stream.id);
    }
    const assetId = live.mux_asset_id || stream?.active_asset_id || stream?.recent_asset_ids?.[0];
    let asset;
    if (assetId) {
      try { asset = await mux.video.assets.retrieve(assetId); }
      catch (error) { if (error.status !== 404) throw error; }
      if (asset && asset.live_stream_id !== live.mux_live_stream_id) throw new Error('Livestream asset mismatch');
    }
    const startedAt = live.started_at || (asset ? new Date(Number(asset.created_at) * 1000) : null);
    const stopped = asset?.is_live === false;
    const finalized = stopped && asset.status === 'ready';
    let status = live.status;
    if (finalized || (stopped && live.started_at)) status = 'ended';
    else if (asset?.status === 'errored') status = 'errored';
    else if (expired || live.status === 'ending') status = startedAt ? 'ending' : 'cancelled';
    else if (!stream) status = startedAt ? 'errored' : 'cancelled';
    else if (!terminal && stream.status === 'active') status = live.status === 'reconnecting' ? 'reconnecting' : 'live';
    else if (!terminal && startedAt && asset?.is_live) status = 'reconnecting';
    if (finalized && stream && stream.status !== 'disabled') await mux.video.liveStreams.disable(stream.id);
    const playbackId = asset?.playback_ids?.find(p => p.policy === live.playback_policy)?.id ?? null;
    await client.query(`UPDATE videos SET mux_asset_id = COALESCE(mux_asset_id, $2),
      mux_status = $3, mux_playback_id = $4,
      duration_seconds = CASE WHEN $5::boolean THEN $6 ELSE duration_seconds END,
      updated_at = NOW() WHERE id = $1`,
    [videoId, assetId ?? null, asset?.status ?? (assetId ? 'deleted' : 'preparing'), playbackId, finalized, Math.round(asset?.duration || 0)]);
    await client.query(`UPDATE video_livestreams SET status = $2, started_at = COALESCE(started_at, $3),
      stop_at = COALESCE(stop_at, $3::timestamptz + max_duration_seconds * interval '1 second'),
      ended_at = CASE WHEN $4::boolean AND $3::timestamptz IS NOT NULL THEN COALESCE(ended_at, GREATEST(NOW(), $3)) ELSE ended_at END,
      recording_finalized_at = CASE WHEN $5::boolean THEN COALESCE(recording_finalized_at, NOW()) ELSE recording_finalized_at END,
      updated_at = NOW() WHERE video_id = $1`,
    [videoId, status, startedAt, status === 'ended', finalized]);
    await client.query('COMMIT');
    if (finalized) finalizedAsset = assetId;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  if (finalizedAsset) await reconcileTracks(finalizedAsset, videoId);
}

export async function handleLivestreamWebhook(event) {
  const data = event.data;
  const isStream = event.type.startsWith('video.live_stream.');
  const isTrack = event.type.startsWith('video.asset.track.');
  const assetId = isStream ? data.active_asset_id : isTrack ? data.asset_id : data.id;
  const streamId = isStream ? data.id : data.live_stream_id;
  const { rows } = await writePool.query(`SELECT l.video_id
    FROM video_livestreams l JOIN videos v ON v.id = l.video_id
    WHERE l.mux_live_stream_id = $1 OR v.mux_asset_id = $2`, [streamId ?? null, assetId ?? null]);
  if (!rows.length) return isStream || Boolean(data.live_stream_id);
  for (const row of rows) {
    await reconcileLivestream(row.video_id);
    // Mux's active status spans the reconnect window. Connection events carry
    // the finer state, with provider timestamps preventing stale regressions.
    const nextStatus = event.type === 'video.live_stream.disconnected' ? 'reconnecting'
      : ['video.live_stream.connected', 'video.live_stream.active'].includes(event.type) ? 'live' : null;
    const eventTime = typeof event.created_at === 'number' ? new Date(event.created_at * 1000) : new Date(event.created_at);
    if (nextStatus && Number.isFinite(eventTime.getTime())) {
      await writePool.query(`UPDATE video_livestreams SET status = $2, last_connection_event_at = $3,
        updated_at = NOW() WHERE video_id = $1 AND status IN ('live', 'reconnecting')
        AND NOT policy_sync_pending AND (stop_at IS NULL OR stop_at > NOW())
        AND (last_connection_event_at IS NULL OR last_connection_event_at < $3)`, [row.video_id, nextStatus, eventTime]);
    }
  }
  return true;
}
