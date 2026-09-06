import {
  sanitizeLang,
  sanitizeName,
  muxGetAsset,
  pickTextTrackByLang,
  fetchVttFromMux,
  callN8nTranslateVtt,
  ensureWebVttHeader,
} from '../helpers/videoModeration.shared.js';
import { readPool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

export async function autogenerateSubtitlePreviewInternal({
  params: routeParams,
  query: queryParams,
}) {
  const responseHeaders = {};
  const { videoId } = routeParams;
  const lang = sanitizeLang(queryParams.lang);
  const name = sanitizeName(queryParams.name, `Subtitles (${lang?.toUpperCase?.() || ''})`);

  if (!lang) {
    throw new HttpError(400, { message: 'Missing query param: lang (e.g. ?lang=sr)' });
  }

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
    const { vttText: enVtt } = await fetchVttFromMux(playbackId, enTrack.id);

    // 5) Pošalji na n8n (prevod)
    const translatedRaw = await callN8nTranslateVtt({
      sourceVtt: enVtt,
      targetLang: lang,
      name,
      videoId,
    });

    if (!translatedRaw) {
      throw new HttpError(502, { message: 'n8n returned empty response' });
    }

    const translatedVtt = ensureWebVttHeader(translatedRaw);

    responseHeaders['Content-Type'] = 'text/vtt; charset=utf-8';
    responseHeaders['X-Subtitles-Source-Lang'] = 'en';
    responseHeaders['X-Subtitles-Target-Lang'] = lang;
    responseHeaders['X-Subtitles-Name'] = name;

    // Pošalji kao plain text u body-ju
    return { status: 200, body: translatedVtt, headers: responseHeaders, format: 'send' };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('autogenerate subtitles error:', err);

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
