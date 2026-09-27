import { reconcileTracks } from '../../../video-indexing/mux-source.service.js';
import crypto from 'crypto';
import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function verifyMuxSignature(rawBodyBuf, muxSignatureHeader, secret) {
  const s = secret?.trim();
  if (!s) return false;
  if (!muxSignatureHeader) return false;

  const parts = muxSignatureHeader.split(',').map((p) => p.trim());

  let t = null;
  const v1s = [];

  for (const part of parts) {
    const [k, v] = part.split('=');
    if (!k || !v) continue;
    const key = k.trim();
    const val = v.trim();
    if (key === 't') t = val;
    if (key === 'v1') v1s.push(val);
  }

  if (!t || v1s.length === 0) return false;
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const payload = Buffer.concat([Buffer.from(`${t}.`), rawBodyBuf]);
  const computed = crypto.createHmac('sha256', s).update(payload).digest('hex');

  // ako postoji više v1 potpisa, dovoljan je match bilo kog
  return v1s.some((sig) => timingSafeEqualStr(computed, sig));
}

function getDefaultThumbnailUrl(playbackId) {
  // početak videa
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0`;
}

export async function muxWebhookInternal({ body: inputBody, headers: requestHeaders }) {
  try {
    // Kada koristiš express.raw(), req.body je Buffer
    const rawBody = Buffer.isBuffer(inputBody)
      ? inputBody
      : Buffer.from(JSON.stringify(inputBody ?? {}), 'utf8');

    const sigHeader = requestHeaders['mux-signature'];
    const ok = verifyMuxSignature(rawBody, sigHeader, process.env.MUX_WEBHOOK_SECRET);

    if (!ok) {
      throw new HttpError(401, { message: 'Invalid Mux signature' });
    }

    // Tek posle verifikacije parsiraj JSON
    const event = Buffer.isBuffer(inputBody) ? JSON.parse(inputBody.toString('utf8')) : inputBody;

    const type = event?.type;
    const data = event?.data;

    if (!type || !data) {
      throw new HttpError(400, { message: 'Invalid webhook payload' });
    }

    // tvoj video id iz baze obično dolazi kroz passthrough ili meta.external_id
    const candidateVideoId = data.passthrough || data?.meta?.external_id || null;
    const videoId = typeof candidateVideoId === 'string'
      && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(candidateVideoId)
      ? candidateVideoId : null;

    // u sample payload-u asset id je data.id
    const muxAssetId = data.id || event?.object?.id || null;

    // playback id: obično data.playback_ids[0].id
    const muxPlaybackId =
      Array.isArray(data.playback_ids) && data.playback_ids.length ? data.playback_ids[0].id : null;

    switch (type) {
      case 'video.asset.track.ready':
      case 'video.asset.track.deleted':
      case 'video.asset.track.errored': {
        const assetId = data.asset_id || (event.object?.type === 'asset' ? event.object.id : null);
        if (!assetId) throw new HttpError(400, { message: 'Missing track asset ID' });
        await reconcileTracks(assetId);
        break;
      }
      case 'video.asset.ready': {
        const durationSeconds = Math.round(Number(data.duration || 0));
        const thumbnailUrl = muxPlaybackId ? getDefaultThumbnailUrl(muxPlaybackId) : null;

        // updejt u bazi
        await writePool.query(
          `
          UPDATE public.videos
          SET
            mux_status = 'ready',
            duration_seconds = $2,
            mux_asset_id = $3,
            mux_playback_id = COALESCE(mux_playback_id, $4),
            thumbnail_url = COALESCE(thumbnail_url, $5)
          WHERE (id = $1::uuid OR mux_asset_id=$3)
            AND (mux_asset_id IS NULL OR mux_asset_id=$3)
            AND mux_status IS DISTINCT FROM 'deleted'
          `,
          [videoId, durationSeconds, muxAssetId, muxPlaybackId, thumbnailUrl],
        );

        await reconcileTracks(muxAssetId, videoId);
        break;
      }

      case 'video.asset.errored': {
        if (!videoId) break;

        await writePool.query(
          `
          UPDATE public.videos
          SET mux_status = 'errored',
              mux_asset_id = COALESCE(mux_asset_id, $2)
          WHERE id = $1 AND mux_status IS DISTINCT FROM 'deleted'
            AND (mux_asset_id IS NULL OR mux_asset_id=$2)
          `,
          [videoId, muxAssetId],
        );

        break;
      }
      case 'video.asset.deleted': {
        // ako imaš FK veze (playlist_items, watch_progress, itd.) i nemaš ON DELETE CASCADE,
        // moraćeš prvo njih da obrišeš ili da koristiš CASCADE u šemi.
        await writePool.query(`DELETE FROM public.videos WHERE mux_asset_id=$1
          OR (id=$2::uuid AND mux_asset_id IS NULL)`, [muxAssetId, videoId]);

        break;
      }
      // dodaj po potrebi: video.asset.created, video.upload.cancelled, etc.
      default:
        break;
    }

    return { received: true };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Webhook processing error:', error);
    throw new HttpError(500, { message: 'Webhook processing failed' });
  }
}
