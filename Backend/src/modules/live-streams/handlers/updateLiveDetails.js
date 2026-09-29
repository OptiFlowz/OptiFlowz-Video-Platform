import Mux from '@mux/mux-node';
import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';

const mux = new Mux();
const options = { maxRetries: 0, timeout: 10000 };
const idSchema = z.string().uuid('Invalid live stream ID');
const bodySchema = z.object({
  title: z.string().trim().min(1).max(512).optional(),
  description: z.string().trim().nullable().optional(),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  playback_policy: z.enum(['public', 'signed']).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
}).strict().refine(data => Object.values(data).some(value => value !== undefined), 'No fields provided');

async function lockStream(client, id, userId) {
  const { rows } = await client.query(`SELECT id, user_id, title, description, thumbnail_url,
    status, mux_status, visibility, playback_policy, dvr_enabled, scheduled_at,
    started_at, ended_at, connected_at, disconnected_at, completed_at, created_at, updated_at,
    mux_live_stream_id, mux_live_playback_id, mux_playback_id_pending_deletion
    FROM public.live_streams WHERE id=$1 AND user_id=$2 FOR UPDATE`, [id, userId]);
  if (!rows[0]) throw new HttpError(404, { message: 'Live stream not found' });
  return rows[0];
}

async function deletePlaybackId(streamId, playbackId) {
  try { await mux.video.liveStreams.deletePlaybackId(streamId, playbackId, options); }
  catch (error) { if (error.status !== 404) throw error; }
}

async function finishCleanup(client, stream) {
  if (!stream.mux_playback_id_pending_deletion) return;
  try {
    await deletePlaybackId(stream.mux_live_stream_id, stream.mux_playback_id_pending_deletion);
  } catch {
    throw new HttpError(502, { message: 'Playback policy was saved, but the previous Mux playback ID could not be deleted. Retry this request to finish cleanup.' });
  }
  await client.query('UPDATE public.live_streams SET mux_playback_id_pending_deletion=NULL WHERE id=$1', [stream.id]);
  stream.mux_playback_id_pending_deletion = null;
}

export async function updateLiveDetailsInternal({ params, body }, userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
  const id = validateOrThrow(idSchema.safeParse(params?.liveStreamId));
  const data = validateOrThrow(bodySchema.safeParse(body));
  const client = await writePool.connect();
  let replacement, muxStreamId;
  let commitAttempted = false;
  try {
    await client.query('BEGIN');
    let stream = await lockStream(client, id, userId);
    await finishCleanup(client, stream);
    const changingPolicy = data.playback_policy !== undefined && data.playback_policy !== stream.playback_policy;
    if (changingPolicy) {
      muxStreamId = stream.mux_live_stream_id;
      try {
        replacement = await mux.video.liveStreams.createPlaybackId(muxStreamId, { policy: data.playback_policy }, options);
      } catch {
        throw new HttpError(502, { message: 'Failed to create the new Mux playback ID' });
      }
      if (!replacement?.id || replacement.policy !== data.playback_policy) {
        throw new HttpError(502, { message: 'Mux returned an invalid playback ID' });
      }
    }
    // Only keys admitted by the strict schema can become column names.
    const values = [id];
    const assignments = [];
    for (const [field, value] of Object.entries(data)) {
      if (value !== undefined) {
        values.push(value);
        assignments.push(`${field}=$${values.length}`);
      }
    }
    if (replacement) {
      values.push(replacement.id);
      assignments.push(`mux_live_playback_id=$${values.length}`);
      values.push(stream.mux_live_playback_id);
      assignments.push(`mux_playback_id_pending_deletion=$${values.length}`);
    }
    await client.query(`UPDATE public.live_streams SET ${assignments.join(', ')}, updated_at=now() WHERE id=$1`, values);
    stream = await lockStream(client, id, userId);
    commitAttempted = true;
    await client.query('COMMIT');

    if (replacement) {
      // Persist cleanup before revoking the old ID, just as for video policy changes.
      await client.query('BEGIN');
      stream = await lockStream(client, id, userId);
      await finishCleanup(client, stream);
      await client.query('COMMIT');
    }
    const { mux_playback_id_pending_deletion, ...live_stream } = stream;
    return { live_stream };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (replacement?.id && !commitAttempted) {
      await deletePlaybackId(muxStreamId, replacement.id)
        .catch(() => console.error('Unused live playback ID cleanup failed'));
    }
    throw error;
  } finally { client.release(); }
}
