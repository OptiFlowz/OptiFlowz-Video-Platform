import Mux from '@mux/mux-node';
import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';

const mux = new Mux();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function deletePlaybackId(assetId, playbackId) {
  try {
    await mux.video.assets.deletePlaybackId(assetId, playbackId);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}

async function finishCleanup(client, video) {
  if (!video.mux_playback_id_pending_deletion) return;
  try {
    await deletePlaybackId(video.mux_asset_id, video.mux_playback_id_pending_deletion);
  } catch {
    throw new HttpError(502, {
      message: 'Playback policy was saved, but the previous Mux playback ID could not be deleted. Retry this request to finish cleanup.',
      code: 'PLAYBACK_CLEANUP_PENDING',
      playback_policy: video.playback_policy,
    });
  }
  await client.query(
    'UPDATE videos SET mux_playback_id_pending_deletion = NULL WHERE id = $1',
    [video.id],
  );
}

async function lockVideo(client, videoId) {
  const { rows } = await client.query(
    `SELECT id, mux_asset_id, mux_playback_id, playback_policy,
            mux_playback_id_pending_deletion
     FROM videos WHERE id = $1 FOR UPDATE`,
    [videoId],
  );
  if (!rows[0]) throw new HttpError(404, { message: 'Video not found' });
  return rows[0];
}

export async function updateVideoPlaybackPolicyInternal({ params, body }) {
  const videoId = params?.videoId;
  const policy = body?.playback_policy;
  if (!uuidPattern.test(String(videoId || ''))) {
    throw new HttpError(400, { message: 'Invalid video ID' });
  }
  if (policy !== 'public' && policy !== 'signed') {
    throw new HttpError(400, { message: "playback_policy must be 'public' or 'signed'" });
  }

  const client = await writePool.connect();
  let replacement;
  let assetId;
  let commitAttempted = false;
  try {
    await client.query('BEGIN');
    const video = await lockVideo(client, videoId);
    await finishCleanup(client, video);
    if (video.playback_policy === policy) {
      await client.query('COMMIT');
      return { id: videoId, playback_policy: policy, mux_playback_id: video.mux_playback_id, changed: false };
    }
    assetId = video.mux_asset_id;
    if (!assetId) throw new HttpError(409, { message: 'Video does not have a Mux asset yet' });

    try {
      replacement = await mux.video.assets.createPlaybackId(assetId, { policy }, { maxRetries: 0 });
    } catch {
      throw new HttpError(502, { message: 'Failed to create the new Mux playback ID' });
    }
    if (!replacement?.id || replacement.policy !== policy) {
      throw new HttpError(502, { message: 'Mux returned an invalid playback ID' });
    }
    await client.query(
      `UPDATE videos SET playback_policy = $2, mux_playback_id = $3,
         mux_playback_id_pending_deletion = $4, updated_at = NOW()
       WHERE id = $1`,
      [videoId, policy, replacement.id, video.mux_playback_id || null],
    );
    // Commit the replacement and cleanup record before revoking the old ID.
    // A failed/ambiguous commit must never cause deletion of the replacement.
    commitAttempted = true;
    await client.query('COMMIT');

    await client.query('BEGIN');
    const current = await lockVideo(client, videoId);
    await finishCleanup(client, current);
    await client.query('COMMIT');
    return { id: videoId, playback_policy: current.playback_policy, mux_playback_id: current.mux_playback_id, changed: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (replacement?.id && !commitAttempted) {
      try {
        await deletePlaybackId(assetId, replacement.id);
      } catch (cleanupError) {
        console.error('Failed to remove unused Mux playback ID', { videoId, assetId, playbackId: replacement.id, status: cleanupError.status });
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
