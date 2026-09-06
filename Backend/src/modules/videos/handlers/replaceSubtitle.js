import { readPool } from '../../../database/index.js';
import { randomUUID } from 'crypto';
import {
  s3,
  R2_BUCKET,
  muxGetAsset,
  muxDeleteTrack,
  muxCreateTextTrack,
  waitForTrackReady,
} from '../helpers/videoModeration.shared.js';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpError } from '../../../common/httpError.js';

export async function replaceSubtitleInternal({
  params: routeParams,
  query: queryParams,
  file: uploadedFile,
}) {
  const { videoId } = routeParams;
  const lang = String(queryParams.lang || '')
    .trim()
    .toLowerCase();
  const trackNameRaw = String(queryParams.name || '').trim();
  const trackName = trackNameRaw.length
    ? trackNameRaw.slice(0, 60)
    : `Subtitles (${lang.toUpperCase()})`;

  if (!lang) {
    throw new HttpError(400, { message: 'Missing query param: lang (e.g. ?lang=en)' });
  }

  if (!trackName) {
    throw new HttpError(400, { message: 'Missing query param: lang (e.g. ?lang=en)' });
  }

  if (!uploadedFile) {
    throw new HttpError(400, { message: 'File is required (field: file)' });
  }

  const filename = (uploadedFile.originalname || '').toLowerCase();
  const isVttName = filename.endsWith('.vtt');
  const isVttMime =
    uploadedFile.mimetype === 'text/vtt' ||
    uploadedFile.mimetype === 'text/plain' ||
    uploadedFile.mimetype === 'application/octet-stream';

  if (!isVttName || !isVttMime) {
    throw new HttpError(400, { message: 'Only .vtt subtitle files are allowed' });
  }

  let tempKey = null;

  try {
    const { rows } = await readPool.query(
      `SELECT mux_asset_id FROM public.videos WHERE id = $1 LIMIT 1`,
      [videoId],
    );
    const assetId = rows[0]?.mux_asset_id;

    if (!assetId) {
      throw new HttpError(404, { message: 'Video not found or missing mux_asset_id' });
    }

    // 2) Upload na R2 temp
    tempKey = `temp/subtitles/${videoId}/${lang}/${randomUUID()}.vtt`;

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: tempKey,
        Body: uploadedFile.buffer,
        ContentType: 'text/vtt',
        CacheControl: 'no-store',
      }),
    );

    // 3) Presigned URL
    const signedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: tempKey }),
      { expiresIn: 60 * 30 },
    );

    // 4) Retrieve asset -> nađi postojeći track ZA TAJ JEZIK
    const assetJson = await muxGetAsset(assetId);
    const tracks = assetJson?.data?.tracks || [];

    const existingLangTrack =
      tracks.find(
        (t) =>
          t.type === 'text' &&
          (t.text_type === 'subtitles' || t.text_type === 'captions') &&
          String(t.language_code || '').toLowerCase() === lang,
      ) || null;

    const oldTrackId = existingLangTrack?.id || null;

    // 5) Obriši samo taj lang track ako postoji
    if (oldTrackId) {
      await muxDeleteTrack(assetId, oldTrackId);
    }

    // 6) Kreiraj novi track za taj jezik
    const created = await muxCreateTextTrack(assetId, signedUrl, {
      language_code: lang,
      name: trackName,
      text_type: 'subtitles',
    });

    const newTrackId = created?.data?.id || null;

    const waitRes = await waitForTrackReady(assetId, newTrackId, 30_000);

    // 7) Briši temp fajl
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: tempKey })).catch(() => {});

    if (!waitRes.ok) {
      throw new HttpError(502, {
        message: 'Mux track was not ready',
        lang,
        track_status: waitRes.status,
        mux_errors: waitRes.errors || null,
      });
    }

    return {
      message: oldTrackId ? 'Subtitle track replaced' : 'Subtitle track created',
      lang,
      name: trackName,
      video_id: videoId,
      mux_asset_id: assetId,
      old_track_id: oldTrackId,
      new_track_id: newTrackId,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('replace subtitles error:', err);

    if (tempKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: tempKey }));
      } catch (e) {}
    }

    const msg = String(err?.message || '');
    if (msg.startsWith('MUX_')) {
      throw new HttpError(502, { message: 'Mux error', details: msg });
    }

    throw new HttpError(500, { message: 'Server error' });
  }
}
