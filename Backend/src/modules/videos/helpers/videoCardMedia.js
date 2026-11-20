import Mux from '@mux/mux-node';
import { readPool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { videoAudienceWhere, videoCardAudienceWhere } from '../../../common/videoAccess.js';

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
  if (card.can_watch !== false && !(duration > 0 && duration < 0.25)) {
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

async function loadCardVideos(cards, userId) {
  const { rows } = await readPool.query(
    `SELECT id, uploaded_by AS uploader_id, thumbnail_url, mux_thumbnail_time, mux_playback_id,
            playback_policy, mux_status, duration_seconds, audience_mode, show_locked_card,
            ${videoCardAudienceWhere('$2')} AS card_visible,
            ($2::uuid IS NOT NULL AND mux_status = 'ready' AND mux_playback_id IS NOT NULL
             AND ${videoAudienceWhere()}) IS TRUE AS can_watch,
            ARRAY(SELECT r.name FROM public.video_allowed_roles ar
                  JOIN public.roles r ON r.id = ar.role_id
                  WHERE ar.video_id = v.id ORDER BY r.name) AS allowed_roles
     FROM public.videos v
     WHERE id = ANY($1::uuid[])
       AND (NOT ${videoCardAudienceWhere('$2')}
         OR (visibility = 'public' AND published_at <= NOW())
         OR (visibility IN ('public', 'private') AND uploaded_by = $2))`,
    [[...new Set(cards.map(card => card.id))], userId],
  );
  return new Map(rows.map(video => [video.id, video]));
}

// Resolve a display thumbnail without generating unused animated previews.
export async function withVideoThumbnailMedia(cards, userId = null) {
  if (!cards.length) return [];
  const videos = await loadCardVideos(cards, userId);
  return Promise.all(cards.map(async card => {
    const video = videos.get(card.id);
    if (video?.card_visible === false) return { ...card, thumbnail_url: null, media_expires_at: null };
    const stored = video?.thumbnail_url?.trim() || null;
    let isMuxImage = false;
    try { isMuxImage = new URL(stored).hostname === 'image.mux.com'; } catch {}
    if (stored && !isMuxImage) {
      return { ...card, thumbnail_url: stored, media_expires_at: null };
    }
    if (!video || video.mux_status !== 'ready' || !video.mux_playback_id) {
      return { ...card, thumbnail_url: null, media_expires_at: null };
    }
    const expiresAt = Math.floor(Date.now() / 1000) + IMAGE_LIFETIME_SECONDS;
    const thumbnailUrl = await imageUrl(
      video.mux_playback_id, video.playback_policy, 'thumbnail.webp', 'thumbnail',
      thumbnailParams(video),
    );
    return {
      ...card,
      thumbnail_url: thumbnailUrl,
      media_expires_at: video.playback_policy === 'signed' ? expiresAt : null,
    };
  }));
}

export async function withVideoCardMedia(cards, userId = null) {
  if (!cards.length) return [];
  const videos = await loadCardVideos(cards, userId);
  return Promise.all(cards.filter(card => videos.get(card.id)?.card_visible !== false).map(card => {
    const video = videos.get(card.id);
    return cardMedia({
      ...card,
      uploader_id: video?.uploader_id ?? null,
      can_watch: video?.can_watch === true,
      audience_mode: video?.audience_mode ?? null,
      show_locked_card: video?.show_locked_card ?? null,
      allowed_roles: video?.allowed_roles ?? [],
    }, video);
  }));
}
