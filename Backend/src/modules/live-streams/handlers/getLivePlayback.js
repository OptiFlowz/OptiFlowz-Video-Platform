import Mux from '@mux/mux-node';
import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';

const mux = new Mux();
const idSchema = z.string().uuid('Invalid live stream ID');
const TOKEN_LIFETIME_SECONDS = 3600;

export async function getLivePlaybackInternal(liveStreamId, userId = null) {
  // Authentication is selected by the route; visibility is enforced for every viewer.
  const id = validateOrThrow(idSchema.safeParse(liveStreamId));
  // Read the primary on each request so visibility changes apply to new tokens.
  // DVR must use this session's asset, never a recording from an earlier session.
  const { rows } = await writePool.query(`SELECT ls.id, ls.user_id, ls.visibility,
    ls.status, ls.mux_status, ls.dvr_enabled, ls.playback_policy, ls.mux_live_playback_id,
    v.id AS video_id, v.mux_playback_id AS recording_playback_id,
    v.playback_policy AS recording_playback_policy
    FROM public.live_streams ls
    LEFT JOIN public.videos v ON v.live_stream_id=ls.id
      AND v.mux_asset_id=ls.mux_active_asset_id
      AND v.mux_recording_completed_at IS NULL
      AND v.mux_status IN ('preparing','ready')
    WHERE ls.id=$1 LIMIT 1`, [id]);
  const stream = rows[0];
  const canView = stream && (['public', 'unlisted'].includes(stream.visibility)
    || (stream.visibility === 'private' && stream.user_id === userId));
  if (!canView) throw new HttpError(404, { message: 'Live stream not found' });
  if (!['live', 'disconnected'].includes(stream.status) || stream.mux_status !== 'active') {
    throw new HttpError(409, { message: 'Live stream is not currently playable' });
  }

  const playbackId = stream.dvr_enabled ? stream.recording_playback_id : stream.mux_live_playback_id;
  const policy = stream.dvr_enabled ? stream.recording_playback_policy : stream.playback_policy;
  if (!playbackId) {
    throw new HttpError(409, { message: stream.dvr_enabled ? 'DVR recording is not ready for playback' : 'Live playback is not ready' });
  }
  const playback = {
    livestream_id: stream.id,
    video_id: stream.video_id ?? null,
    status: stream.status,
    dvr_enabled: stream.dvr_enabled,
    playback_mode: stream.dvr_enabled ? 'dvr' : 'live',
    playback_source: stream.dvr_enabled ? 'asset' : 'live_stream',
    mux_playback_id: playbackId,
    playback_policy: policy,
    stream_url: `https://stream.mux.com/${playbackId}.m3u8`,
    tokens: {},
    expires_at: null,
  };
  if (policy === 'public') return playback;
  if (policy !== 'signed') throw new HttpError(503, { message: 'Live playback policy is not configured' });
  if (!mux.jwtSigningKey || !mux.jwtPrivateKey) {
    throw new HttpError(503, { message: 'Signed playback is not configured' });
  }
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS;
  const signed = await mux.jwt.signPlaybackId(playbackId, {
    type: ['video', 'thumbnail', 'storyboard'], expiration: `${TOKEN_LIFETIME_SECONDS}s`,
  });
  playback.tokens = {
    playback: signed['playback-token'], thumbnail: signed['thumbnail-token'], storyboard: signed['storyboard-token'],
  };
  playback.stream_url += `?token=${playback.tokens.playback}`;
  playback.expires_at = expiresAt;
  return playback;
}
