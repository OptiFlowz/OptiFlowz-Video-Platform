import Mux from '@mux/mux-node';
import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';

const mux = new Mux();
// Mux allows up to 12 hours; DVR streams must stay below four hours.
const DVR_MAX_DURATION_SECONDS = 4 * 60 * 60 - 1;
const MAX_DURATION_SECONDS = 12 * 60 * 60;

const createLiveStreamSchema = z.object({
  title: z.string().trim().min(1).max(512),
  description: z.string().trim().nullable().optional().default(null),
  dvr_enabled: z.boolean().optional().default(false),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional().default(null),
  visibility: z.enum(['public', 'unlisted', 'private']).optional().default('public'),
  playback_policy: z.enum(['public', 'signed']).optional().default('signed'),
}).strict();

export async function createLiveStreamInternal(body, userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
  const data = validateOrThrow(createLiveStreamSchema.safeParse(body));
  const maxDuration = data.dvr_enabled ? DVR_MAX_DURATION_SECONDS : MAX_DURATION_SECONDS;

  let stream;
  try {
    stream = await mux.video.liveStreams.create({
      playback_policies: [data.playback_policy],
      new_asset_settings: { playback_policies: [data.playback_policy] },
      max_continuous_duration: maxDuration,
      meta: { title: data.title },
    }, { maxRetries: 0 });
  } catch {
    throw new HttpError(502, { message: 'Unable to create Mux live stream' });
  }

  let client;
  let commitAttempted = false;
  try {
    const playbackId = stream.playback_ids?.find(playback => playback.policy === data.playback_policy)?.id;
    if (!stream.id || !playbackId || !stream.stream_key) {
      throw new HttpError(502, { message: 'Mux returned an incomplete live stream' });
    }

    client = await writePool.connect();
    await client.query('BEGIN');
    // The content exists before a recording does. Publication is handled later,
    // independently from the planned live broadcast time.
    const { rows: videos } = await client.query(
      `INSERT INTO public.videos (
         uploaded_by, title, description, visibility, playback_policy, mux_status, published_at
       ) VALUES ($1, $2, $3, $4, $5, 'preparing', NULL)
       RETURNING *`,
      [userId, data.title, data.description, data.visibility, data.playback_policy],
    );
    const video = videos[0];
    const { rows } = await client.query(
      `INSERT INTO public.live_streams (
         video_id, dvr_enabled, scheduled_at, mux_live_stream_id, mux_live_playback_id
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [video.id, data.dvr_enabled, data.scheduled_at, stream.id, playbackId],
    );
    commitAttempted = true;
    await client.query('COMMIT');

    return {
      video,
      live_stream: rows[0],
      stream_key: stream.stream_key,
      max_continuous_duration: maxDuration,
    };
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    // A failed COMMIT response may still mean the row was committed. Keep its
    // Mux resource in that case; only delete a stream known not to be saved.
    if (stream.id && !commitAttempted) {
      try {
        await mux.video.liveStreams.delete(stream.id);
      } catch (cleanupError) {
        if (cleanupError.status !== 404) {
          console.error('Mux live stream cleanup failed:', { mux_live_stream_id: stream.id });
        }
      }
    }
    throw error;
  } finally {
    client?.release();
  }
}
