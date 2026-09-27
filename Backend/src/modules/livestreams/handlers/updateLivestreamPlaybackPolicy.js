import Mux from '@mux/mux-node';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

const mux = new Mux({ maxRetries: 0, timeout: 15000 });
const ignoreMissing = async fn => { try { await fn(); } catch (e) { if (e.status !== 404) throw e; } };

export async function synchronizePlaybackIds(api, resource, policy) {
  let playback = resource.playback_ids?.find(p => p.policy === policy);
  if (!playback) playback = await api.createPlaybackId(resource.id, { policy });
  if (!playback?.id || playback.policy !== policy) throw new Error('Invalid Mux playback ID');
  for (const old of resource.playback_ids || []) {
    if (old.id !== playback.id) await ignoreMissing(() => api.deletePlaybackId(resource.id, old.id));
  }
  return playback.id;
}

export async function updateLivestreamPlaybackPolicyInternal(videoId, policy) {
  const client = await writePool.connect();
  let locked = false;
  let unconfirmedReplacement;
  try {
    // This session lock survives the commit that records the retryable intent.
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [`live-policy:${videoId}`]);
    locked = true;
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT v.title, v.visibility, v.playback_policy, v.mux_asset_id, l.*
      FROM videos v JOIN video_livestreams l ON l.video_id = v.id WHERE v.id = $1 FOR UPDATE OF v, l`, [videoId]);
    const live = rows[0];
    if (!live) throw new HttpError(404, { message: 'Livestream not found' });
    if (live.visibility === 'private' && policy === 'public') throw new HttpError(400, { message: 'Private livestreams require signed playback' });
    if (live.policy_sync_pending && live.playback_policy !== policy) throw new HttpError(409, { message: 'Retry the pending playback policy change first' });
    let stream = await mux.video.liveStreams.retrieve(live.mux_live_stream_id);
    const assetId = live.mux_asset_id || stream.active_asset_id || stream.recent_asset_ids?.[0];
    const unused = !live.started_at && !assetId && !stream.recent_asset_ids?.length;
    await client.query('UPDATE videos SET playback_policy = $2 WHERE id = $1', [videoId, policy]);
    await client.query('UPDATE video_livestreams SET policy_sync_pending = true WHERE video_id = $1', [videoId]);
    await client.query('COMMIT');

    if (unused && stream.new_asset_settings?.playback_policies?.[0] !== policy) {
      await mux.video.liveStreams.disable(stream.id);
      // Check again after disabling: the encoder may have connected concurrently.
      stream = await mux.video.liveStreams.retrieve(stream.id);
      if (stream.active_asset_id || stream.recent_asset_ids?.length) throw new HttpError(409, { message: 'Broadcast started during policy change; retry to synchronize its recording' });
      const reconnect = Math.min(60, live.max_duration_seconds - 60);
      const replacement = await mux.video.liveStreams.create({
        playback_policies: [policy], passthrough: videoId, meta: { title: live.title },
        latency_mode: 'standard', reconnect_window: reconnect,
        max_continuous_duration: live.max_duration_seconds - reconnect,
        new_asset_settings: { playback_policies: [policy], meta: { title: live.title, external_id: videoId } },
      });
      unconfirmedReplacement = replacement.id;
      const playbackId = replacement.playback_ids?.find(p => p.policy === policy)?.id;
      if (!replacement.id || !playbackId) throw new Error('Invalid replacement stream');
      if (live.status !== 'scheduled') await mux.video.liveStreams.disable(replacement.id);
      await client.query(`UPDATE video_livestreams SET mux_live_stream_id = $2,
        mux_live_playback_id = $3, mux_stream_pending_deletion = $4 WHERE video_id = $1`,
      [videoId, replacement.id, playbackId, stream.id]);
      unconfirmedReplacement = null;
      live.mux_stream_pending_deletion = stream.id;
      stream = replacement;
    }
    const livePlaybackId = await synchronizePlaybackIds(mux.video.liveStreams, stream, policy);
    let assetPlaybackId = null;
    if (assetId) {
      const asset = await mux.video.assets.retrieve(assetId);
      assetPlaybackId = await synchronizePlaybackIds(mux.video.assets, asset, policy);
    }
    if (live.mux_stream_pending_deletion) await ignoreMissing(() => mux.video.liveStreams.delete(live.mux_stream_pending_deletion));
    // Once a broadcast has started this application never reuses its Mux stream.
    // The lifecycle handler disables it on completion, preventing future assets
    // from inheriting an outdated policy.
    await client.query('BEGIN');
    await client.query(`UPDATE videos SET mux_asset_id = COALESCE(mux_asset_id, $2),
      mux_playback_id = $3, updated_at = NOW() WHERE id = $1`, [videoId, assetId ?? null, assetPlaybackId]);
    await client.query(`UPDATE video_livestreams SET mux_live_playback_id = $2,
      policy_sync_pending = false, mux_stream_pending_deletion = NULL, updated_at = NOW() WHERE video_id = $1`, [videoId, livePlaybackId]);
    await client.query('COMMIT');
    return { id: videoId, playback_policy: policy, mux_live_playback_id: livePlaybackId, mux_playback_id: assetPlaybackId, changed: true };
  } catch (error) {
    if (unconfirmedReplacement) console.error('Livestream policy replacement needs reconciliation', { videoId, muxStreamId: unconfirmedReplacement });
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, { message: 'Livestream policy synchronization failed. Retry the same policy to finish synchronization.' });
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`live-policy:${videoId}`]).catch(() => {});
    client.release();
  }
}
