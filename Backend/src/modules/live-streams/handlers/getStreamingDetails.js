import Mux from '@mux/mux-node';
import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';

const mux = new Mux();
const liveStreamIdSchema = z.string().uuid('Invalid live stream ID');
// Mux's secure ingest endpoint for OBS and other RTMPS encoders.
const STREAMING_SERVER = 'rtmps://global-live.mux.com:443/app';

export async function getStreamingDetailsInternal(liveStreamId, userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
  const id = validateOrThrow(liveStreamIdSchema.safeParse(liveStreamId));
  // Check ownership on the primary before fetching encoder credentials.
  const { rows } = await writePool.query(
    `SELECT ls.mux_live_stream_id, ls.status
     FROM public.live_streams ls
     WHERE ls.id = $1 AND ls.user_id = $2
     LIMIT 1`,
    [id, userId],
  );
  const liveStream = rows[0];
  if (!liveStream) throw new HttpError(404, { message: 'Live stream not found' });
  if (['ended', 'cancelled'].includes(liveStream.status)) {
    throw new HttpError(409, { message: 'This live stream has ended or was cancelled' });
  }

  let stream;
  try {
    stream = await mux.video.liveStreams.retrieve(liveStream.mux_live_stream_id);
  } catch (error) {
    if (error.status === 404) throw new HttpError(404, { message: 'Mux live stream not found' });
    throw new HttpError(502, { message: 'Unable to retrieve streaming details' });
  }
  if (stream.status === 'disabled') {
    throw new HttpError(409, { message: 'This Mux live stream is disabled' });
  }
  if (typeof stream.stream_key !== 'string' || !stream.stream_key.trim()) {
    throw new HttpError(502, { message: 'Mux did not return a stream key' });
  }

  return { server: STREAMING_SERVER, stream_key: stream.stream_key };
}
