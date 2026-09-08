import Mux from '@mux/mux-node';
import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';

const mux = new Mux();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getVideoPlaybackInternal(videoId, userId = null) {
  if (!UUID_PATTERN.test(String(videoId || ''))) {
    throw new HttpError(400, { message: 'Invalid video ID' });
  }

  // Use the primary so recent visibility changes apply when issuing new tokens.
  const { rows } = await writePool.query(
    `SELECT id, uploaded_by, visibility, mux_status, mux_playback_id,
            playback_policy, duration_seconds
     FROM public.videos
     WHERE id = $1
     LIMIT 1`,
    [videoId],
  );
  const video = rows[0];
  const canView = video && (
    video.visibility === 'public'
    || (video.visibility === 'private' && userId && video.uploaded_by === userId)
  );

  if (!canView) {
    throw new HttpError(404, { message: 'Video not found' });
  }
  if (video.mux_status !== 'ready' || !video.mux_playback_id) {
    throw new HttpError(409, { message: 'Video is not ready for playback' });
  }

  const playback = {
    video_id: video.id,
    mux_playback_id: video.mux_playback_id,
    playback_policy: video.playback_policy,
    stream_url: `https://stream.mux.com/${video.mux_playback_id}.m3u8`,
    tokens: {},
    expires_at: null,
  };

  if (video.playback_policy === 'public') return playback;
  if (video.playback_policy !== 'signed') {
    throw new HttpError(503, { message: 'Video playback policy is not configured' });
  }
  if (!mux.jwtSigningKey || !mux.jwtPrivateKey) {
    throw new HttpError(503, { message: 'Signed playback is not configured' });
  }

  // At least one hour, or the full video duration plus a 30-minute pause buffer.
  const duration = Number(video.duration_seconds);
  const lifetime = Math.max(3600, (Number.isFinite(duration) ? Math.ceil(duration) : 0) + 1800);
  // This conservative refresh deadline is no later than the tokens' expiry.
  const expiresAt = Math.floor(Date.now() / 1000) + lifetime;
  const signed = await mux.jwt.signPlaybackId(video.mux_playback_id, {
    type: ['video', 'thumbnail', 'storyboard'],
    expiration: `${lifetime}s`,
  });

  playback.tokens = {
    playback: signed['playback-token'],
    thumbnail: signed['thumbnail-token'],
    storyboard: signed['storyboard-token'],
  };
  playback.stream_url += `?token=${playback.tokens.playback}`;
  playback.expires_at = expiresAt;
  return playback;
}
