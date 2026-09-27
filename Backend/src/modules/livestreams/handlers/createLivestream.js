import Mux from '@mux/mux-node';
import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';

const createLivestreamSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10000).nullable().optional().default(null),
  mode: z.enum(['standard', 'dvr']).optional().default('standard'),
  visibility: z.enum(['public', 'private']).optional().default('private'),
  playback_policy: z.enum(['public', 'signed']).optional().default('signed'),
  scheduled_start_at: z.iso.datetime({ offset: true }).nullable().optional().default(null),
  max_duration_seconds: z.number().int().min(60).max(43200).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'dvr' && value.max_duration_seconds >= 14400) {
    ctx.addIssue({ code: 'custom', path: ['max_duration_seconds'], message: 'DVR streams must be shorter than four hours' });
  }
  if (value.visibility === 'private' && value.playback_policy === 'public') {
    ctx.addIssue({ code: 'custom', path: ['playback_policy'], message: 'Private livestreams require signed playback' });
  }
});

function muxFailureDetails(error, videoId) {
  // Mux's SDK retains the API envelope under error.error, including its nested
  // `error` property. Read selected diagnostics, never serialize the SDK error.
  const detail = error?.error?.error ?? error?.error;
  const secrets = [process.env.MUX_TOKEN_ID, process.env.MUX_TOKEN_SECRET];
  if (secrets.every(Boolean)) secrets.push(Buffer.from(`${secrets[0]}:${secrets[1]}`).toString('base64'));
  const redact = value => {
    let text = String(value);
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[REDACTED]');
    return text.replace(/((?:stream_key|token_secret|authorization)["']?\s*[:=]\s*)["']?[^\s,"'}]+/gi, '$1[REDACTED]').slice(0, 1000);
  };
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  return {
    video_id: videoId,
    status: Number.isInteger(error?.status) ? error.status : null,
    type: typeof detail?.type === 'string' ? redact(detail.type) : null,
    messages: messages.filter(message => typeof message === 'string').slice(0, 5).map(redact),
  };
}

export async function createLivestreamInternal(body, actorUserId = null) {
  if (!actorUserId) throw new HttpError(401, { message: 'Unauthorized' });
  const data = validateOrThrow(createLivestreamSchema.safeParse(body));
  const maxDuration = data.max_duration_seconds ?? (data.mode === 'dvr' ? 14399 : 43200);
  // Reserve the reconnect window within the configured duration budget while
  // respecting Mux's minimum continuous duration of 60 seconds.
  const reconnectWindow = Math.min(60, maxDuration - 60);

  if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
    throw new HttpError(503, { message: 'Livestreaming is not configured' });
  }
  // Automatic retries of a create request could create an untracked stream.
  const mux = new Mux({
    tokenId: process.env.MUX_TOKEN_ID,
    tokenSecret: process.env.MUX_TOKEN_SECRET,
    maxRetries: 0,
    timeout: 15000,
  });

  let client;
  let stream;
  let videoId;
  let transactionStarted = false;
  let commitStarted = false;
  try {
    client = await writePool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    const { rows: videos } = await client.query(
      `INSERT INTO public.videos (title, description, uploaded_by, kind, visibility, playback_policy, published_at)
       VALUES ($1, $2, $3, 'live', $4, $5, CASE WHEN $4 = 'public' THEN NOW() ELSE NULL END)
       RETURNING id, title, description, uploaded_by, kind, visibility, playback_policy, published_at, created_at`,
      [data.title, data.description, actorUserId, data.visibility, data.playback_policy],
    );
    videoId = videos[0].id;
    try {
      stream = await mux.video.liveStreams.create({
        playback_policies: [data.playback_policy],
        passthrough: videoId,
        meta: { title: data.title },
        latency_mode: 'standard',
        reconnect_window: reconnectWindow,
        max_continuous_duration: maxDuration - reconnectWindow,
        new_asset_settings: {
          playback_policies: [data.playback_policy],
          // Mux copies the top-level passthrough to the recording. Supplying
          // new_asset_settings.passthrough on live creation is rejected.
          meta: { title: data.title, external_id: videoId },
        },
      });
    } catch (error) {
      console.error('Mux livestream creation failed:', muxFailureDetails(error, videoId));
      // Only requests without a definitive client-error response have an
      // uncertain outcome and may need provider-side reconciliation.
      if (!error.status || error.status >= 500 || error.status === 408) {
        console.error('Mux creation outcome may need reconciliation; video:', videoId);
      }
      throw new HttpError(502, { message: 'Could not create livestream with Mux' });
    }
    const playbackId = stream.playback_ids?.find(playback => playback.policy === data.playback_policy)?.id;
    if (!stream.id || !playbackId) {
      throw new HttpError(502, { message: 'Mux returned an incomplete livestream' });
    }
    const { rows: lives } = await client.query(
      `INSERT INTO public.video_livestreams
         (video_id, mode, status, mux_live_stream_id, mux_live_playback_id, scheduled_start_at, max_duration_seconds)
       VALUES ($1, $2, 'scheduled', $3, $4, $5, $6)
       RETURNING video_id, mode, status, mux_live_stream_id, mux_live_playback_id,
                 scheduled_start_at, max_duration_seconds, started_at, ended_at, stop_at, recording_finalized_at`,
      [videoId, data.mode, stream.id, playbackId, data.scheduled_start_at, maxDuration],
    );
    const result = { ...videos[0], ...lives[0] };
    commitStarted = true;
    await client.query('COMMIT');
    transactionStarted = false;
    // Only return persisted metadata. Stream keys require broadcast permission.
    return result;
  } catch (error) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    if (stream?.id && !commitStarted) {
      try {
        await mux.video.liveStreams.delete(stream.id);
      } catch (cleanupError) {
        if (cleanupError.status !== 404) {
          console.error('Livestream cleanup required for Mux stream:', stream.id, 'video:', videoId);
        }
      }
    } else if (commitStarted) {
      // A lost COMMIT acknowledgement does not prove rollback. Do not delete a
      // provider stream that may be referenced by a successfully committed row.
      console.error('Livestream commit outcome requires reconciliation; video:', videoId, 'Mux stream:', stream?.id);
    }
    if (error instanceof HttpError) throw error;
    console.error('Livestream database operation failed; video:', videoId ?? null);
    throw new HttpError(500, { message: 'Failed to create livestream' });
  } finally {
    client?.release();
  }
}
