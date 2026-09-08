import Mux from '@mux/mux-node';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

const mux = new Mux();
const IMAGE_LIFETIME_SECONDS = 3600;
function thumbnailParams(video, time = video.mux_thumbnail_time) {
  const params = {
    time: typeof time === 'number' && Number.isFinite(time) && time >= 0 ? time : 0,
    width: 1280,
    height: 720,
    fit_mode: 'preserve',
  };
  const duration = Number(video.duration_seconds);
  if (duration > 0) params.time = Math.min(params.time, Math.max(0, duration - 0.001));
  return params;
}

async function imageUrl(playbackId, policy, path, type, params) {
  const base = `https://image.mux.com/${playbackId}/${path}`;
  if (policy === 'public') return `${base}?${new URLSearchParams(params)}`;
  if (policy !== 'signed') {
    throw new HttpError(503, { message: 'Video playback policy is not configured' });
  }
  if (!mux.jwtSigningKey || !mux.jwtPrivateKey) {
    throw new HttpError(503, { message: 'Signed video images are not configured' });
  }
  const token = await mux.jwt.signPlaybackId(playbackId, {
    type,
    expiration: `${IMAGE_LIFETIME_SECONDS}s`,
    params,
  });
  return `${base}?token=${token}`;
}

async function cardMedia(card, video) {
  const media = {
    thumbnail_url: video?.thumbnail_url ?? null,
    mux_thumbnail_url: null,
    preview_url: null,
    media_expires_at: null,
  };
  if (!video || video.mux_status !== 'ready' || !video.mux_playback_id) {
    return { ...card, ...media };
  }

  const duration = Number(video.duration_seconds);
  const progress = Number(card.progress_seconds);
  const previewParams = { width: 640, fps: 10, start: 0 };
  if (Number.isFinite(duration) && duration > 0) {
    const preferredStart = Number.isFinite(progress) && progress > 0 ? progress : duration / 2;
    previewParams.start = Math.max(0, Math.min(preferredStart, duration - 0.25));
    previewParams.end = Math.min(duration, previewParams.start + 5);
  }
  const expiresAt = Math.floor(Date.now() / 1000) + IMAGE_LIFETIME_SECONDS;
  media.mux_thumbnail_url = await imageUrl(
    video.mux_playback_id, video.playback_policy, 'thumbnail.webp', 'thumbnail',
    thumbnailParams(video),
  );
  // Mux animated images require at least 250 ms of video.
  if (!(duration > 0 && duration < 0.25)) {
    media.preview_url = await imageUrl(
      video.mux_playback_id, video.playback_policy, 'animated.webp', 'gif', previewParams,
    );
  }
  if (video.playback_policy === 'signed') media.media_expires_at = expiresAt;
  return { ...card, ...media };
}

// The caller must load and authorize this video before requesting its media.
export async function withVideoDetailsMedia(video) {
  const result = await cardMedia(video, video);
  if (!Array.isArray(video.chapters)) return result;

  result.chapters = await Promise.all(video.chapters.map(async chapter => {
    const start = chapter?.startTime;
    let thumbnailUrl = null;
    if (video.mux_status === 'ready' && video.mux_playback_id
      && typeof start === 'number' && Number.isFinite(start) && start >= 0) {
      const params = thumbnailParams(video, start);
      thumbnailUrl = await imageUrl(
        video.mux_playback_id, video.playback_policy, 'thumbnail.webp', 'thumbnail', params,
      );
    }
    return { ...chapter, thumbnail_url: thumbnailUrl };
  }));
  return result;
}

export async function withVideoCardMedia(cards, userId = null) {
  if (!cards.length) return [];
  // One primary read per list prevents signing stale private/deleted video data
  // returned by a replica, and also supplies fields absent from older card SQL.
  const { rows } = await writePool.query(
    `SELECT id, thumbnail_url, mux_thumbnail_time, mux_playback_id,
            playback_policy, mux_status, duration_seconds
     FROM public.videos
     WHERE id = ANY($1::uuid[])
       AND (visibility = 'public' OR (visibility = 'private' AND uploaded_by = $2))`,
    [[...new Set(cards.map(card => card.id))], userId],
  );
  const videos = new Map(rows.map(video => [video.id, video]));
  return Promise.all(cards.map(card => cardMedia(card, videos.get(card.id))));
}
