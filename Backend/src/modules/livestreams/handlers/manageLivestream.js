import Mux from '@mux/mux-node';
import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';

const mux = new Mux({ maxRetries: 0, timeout: 15000 });
export async function getLivestreamCredentialsInternal(videoId) {
  const { rows } = await writePool.query('SELECT * FROM video_livestreams WHERE video_id = $1', [videoId]);
  const live = rows[0];
  if (!live) throw new HttpError(404, { message: 'Livestream not found' });
  if (!['scheduled', 'live', 'reconnecting'].includes(live.status) || live.policy_sync_pending) throw new HttpError(409, { message: 'Broadcast is unavailable' });
  const stream = await mux.video.liveStreams.retrieve(live.mux_live_stream_id);
  return { stream_key: stream.stream_key, rtmps_url: 'rtmps://global-live.mux.com:443/app', video_id: videoId };
}

export async function endLivestreamInternal(videoId) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM video_livestreams WHERE video_id = $1 FOR UPDATE', [videoId]);
    const live = rows[0];
    if (!live) throw new HttpError(404, { message: 'Livestream not found' });
    if (live.policy_sync_pending) throw new HttpError(409, { message: 'Finish the pending playback policy change first' });
    if (live.mux_live_stream_id) await mux.video.liveStreams.disable(live.mux_live_stream_id);
    const status = ['ended', 'cancelled'].includes(live.status) ? live.status : live.started_at ? 'ending' : 'cancelled';
    await client.query('UPDATE video_livestreams SET status = $2, updated_at = NOW() WHERE video_id = $1', [videoId, status]);
    await client.query('COMMIT');
    return { video_id: videoId, status };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

const settingsSchema = z.object({
  mode: z.enum(['standard', 'dvr']).optional(),
  scheduled_start_at: z.iso.datetime({ offset: true }).nullable().optional(),
  max_duration_seconds: z.number().int().min(60).max(43200).optional(),
}).strict().refine(body => Object.keys(body).length > 0, 'No fields provided');

export async function updateLivestreamSettingsInternal(videoId, body) {
  const input = validateOrThrow(settingsSchema.safeParse(body));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM video_livestreams WHERE video_id = $1 FOR UPDATE', [videoId]);
    const live = rows[0];
    if (!live) throw new HttpError(404, { message: 'Livestream not found' });
    if (live.status !== 'scheduled' || live.started_at || live.policy_sync_pending) throw new HttpError(409, { message: 'Settings can only be changed before broadcasting' });
    const mode = input.mode ?? live.mode;
    const duration = input.max_duration_seconds ?? live.max_duration_seconds;
    if (mode === 'dvr' && duration >= 14400) throw new HttpError(400, { message: 'DVR streams must be shorter than four hours' });
    const stream = await mux.video.liveStreams.retrieve(live.mux_live_stream_id);
    if (stream.active_asset_id || stream.status === 'active') throw new HttpError(409, { message: 'Broadcast has already started' });
    const reconnect = Math.min(60, duration - 60);
    await mux.video.liveStreams.update(live.mux_live_stream_id, { reconnect_window: reconnect, max_continuous_duration: duration - reconnect });
    await client.query(`UPDATE video_livestreams SET mode = $2, max_duration_seconds = $3,
      scheduled_start_at = $4, updated_at = NOW() WHERE video_id = $1`,
    [videoId, mode, duration, input.scheduled_start_at === undefined ? live.scheduled_start_at : input.scheduled_start_at]);
    await client.query('COMMIT');
    return { video_id: videoId, mode, max_duration_seconds: duration };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function deleteLivestreamInternal(videoId) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT v.mux_asset_id, l.* FROM videos v JOIN video_livestreams l ON l.video_id = v.id WHERE v.id = $1 FOR UPDATE OF v, l`, [videoId]);
    const live = rows[0];
    if (!live) throw new HttpError(404, { message: 'Livestream not found' });
    if (live.policy_sync_pending) throw new HttpError(409, { message: 'Finish the pending playback policy change first' });
    if (['live', 'reconnecting', 'ending'].includes(live.status)) throw new HttpError(409, { message: 'End the broadcast and wait for it to finish before deleting it' });
    const ignoreMissing = async fn => { try { await fn(); } catch (e) { if (e.status !== 404) throw e; } };
    if (live.mux_live_stream_id) {
      let stream;
      await ignoreMissing(async () => { stream = await mux.video.liveStreams.retrieve(live.mux_live_stream_id); });
      if (stream?.status === 'active' || stream?.active_asset_id) throw new HttpError(409, { message: 'End the active broadcast before deleting it' });
      await ignoreMissing(() => mux.video.liveStreams.delete(live.mux_live_stream_id));
    }
    if (live.mux_stream_pending_deletion) await ignoreMissing(() => mux.video.liveStreams.delete(live.mux_stream_pending_deletion));
    if (live.mux_asset_id) await ignoreMissing(() => mux.video.assets.delete(live.mux_asset_id));
    await client.query('DELETE FROM videos WHERE id = $1', [videoId]);
    await client.query('COMMIT');
    return { success: true, video_id: videoId };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
