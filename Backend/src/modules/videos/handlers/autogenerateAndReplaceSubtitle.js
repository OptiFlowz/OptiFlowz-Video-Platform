import {
  sanitizeLang,
  sanitizeName,
  muxGetAsset,
  pickTextTrackByLang,
  fetchVttFromMux,
  callN8nTranslateVtt,
  ensureWebVttHeader,
  s3,
  R2_BUCKET,
  muxDeleteTrack,
  muxCreateTextTrack,
  waitForTrackReady,
} from '../helpers/videoModeration.shared.js';
import { readPool } from '../../../database/index.js';
import { randomUUID } from 'crypto';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpError } from '../../../common/httpError.js';

export async function autogenerateAndReplaceSubtitleInternal({
  params: routeParams,
  query: queryParams,
}) {
  const { videoId } = routeParams;
  const lang = sanitizeLang(queryParams.lang);
  const name = sanitizeName(queryParams.name, `Subtitles (${lang.toUpperCase()})`);

  if (!lang) {
    throw new HttpError(400, { message: 'Missing query param: lang (e.g. ?lang=sr)' });
  }

  let tempKey = null;

  try {
    // 1) DB: uzmi mux ids
    const { rows } = await readPool.query(
      `SELECT mux_asset_id, mux_playback_id FROM public.videos WHERE id = $1 LIMIT 1`,
      [videoId],
    );
    const assetId = rows[0]?.mux_asset_id;
    const playbackId = rows[0]?.mux_playback_id;

    if (!assetId || !playbackId) {
      throw new HttpError(404, { message: 'Video not found or missing mux ids' });
    }

    // 2) Mux: retrieve asset tracks
    const assetJson = await muxGetAsset(assetId);
    const tracks = assetJson?.data?.tracks || [];

    // 3) Nađi EN track (ako ne postoji -> greška)
    const enTrack = pickTextTrackByLang(tracks, 'en');
    if (!enTrack?.id) {
      throw new HttpError(404, {
        message: 'English subtitle track (en) does not exist on this asset',
      });
    }

    // 4) Skini EN VTT
    const { vttText: enVtt, vttUrl: enVttUrl } = await fetchVttFromMux(playbackId, enTrack.id);

    // 5) Pošalji na n8n (prevod)
    const translatedRaw = await callN8nTranslateVtt({
      sourceVtt: enVtt,
      targetLang: lang,
      name,
      videoId,
    });

    if (!translatedRaw) throw new HttpError(404, { message: 'N8n Error' });
    const translatedVtt = ensureWebVttHeader(translatedRaw);

    // 6) Upload prevedeni VTT na R2 temp
    tempKey = `temp/subtitles/${videoId}/${lang}/${randomUUID()}.vtt`;

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: tempKey,
        Body: Buffer.from(translatedVtt, 'utf-8'),
        ContentType: 'text/vtt; charset=utf-8',
        CacheControl: 'no-store',
      }),
    );

    // 7) Presigned URL (Mux povlači)
    const signedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: tempKey }),
      { expiresIn: 60 * 30 },
    );

    // 8) Osveži tracks i nađi postojeći track za target lang
    const assetJson2 = await muxGetAsset(assetId);
    const tracks2 = assetJson2?.data?.tracks || [];

    const existingTargetTrack = pickTextTrackByLang(tracks2, lang);
    const oldTrackId = existingTargetTrack?.id || null;

    // 9) Ako postoji, obriši ga (replace). Ako ne postoji, samo create.
    if (oldTrackId) {
      await muxDeleteTrack(assetId, oldTrackId);
    }

    // 10) Kreiraj novi track za target lang + name
    const created = await muxCreateTextTrack(assetId, signedUrl, {
      language_code: lang,
      name,
      text_type: 'subtitles',
    });

    const newTrackId = created?.data?.id || null;

    // 11) Sačekaj ready
    const waitRes = await waitForTrackReady(assetId, newTrackId, 60_000);

    // 12) Očisti temp fajl
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: tempKey })).catch(() => {});

    if (!waitRes.ok) {
      throw new HttpError(502, {
        message: 'Mux track was not ready',
        lang,
        name,
        track_status: waitRes.status,
        mux_errors: waitRes.errors || null,
      });
    }

    return {
      message: oldTrackId
        ? 'Subtitle auto-generated & replaced'
        : 'Subtitle auto-generated & created',
      video_id: videoId,
      mux_asset_id: assetId,
      source_lang: 'en',
      target_lang: lang,
      name,
      source_track_id: enTrack.id,
      old_track_id: oldTrackId,
      new_track_id: newTrackId,
      source_vtt_url: enVttUrl,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('autogenerate subtitles error:', err);

    if (tempKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: tempKey }));
      } catch (e) {}
    }

    const msg = String(err?.message || '');
    if (msg.startsWith('MUX_')) {
      throw new HttpError(502, { message: 'Mux error', details: msg });
    }
    if (
      msg.startsWith('N8N_') ||
      msg === 'N8N_WEBHOOK_NOT_CONFIGURED' ||
      msg === 'N8N_RETURNED_EMPTY_VTT'
    ) {
      throw new HttpError(502, { message: 'n8n error', details: msg });
    }

    throw new HttpError(500, { message: 'Server error' });
  }
}
