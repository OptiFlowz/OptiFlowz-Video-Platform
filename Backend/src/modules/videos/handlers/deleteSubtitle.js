import { readPool } from '../../../database/index.js';
import { muxGetAsset, muxDeleteTrack } from '../helpers/videoModeration.shared.js';
import { HttpError } from '../../../common/httpError.js';

export async function deleteSubtitleInternal({ params: routeParams, query: queryParams }) {
  try {
    const { videoId } = routeParams;
    const lang = String(queryParams.lang || '')
      .trim()
      .toLowerCase();

    if (!lang) {
      throw new HttpError(400, { message: 'Missing query param: lang (e.g. ?lang=en)' });
    }

    // 1) Uzmi mux_asset_id iz baze
    const { rows } = await readPool.query(
      `SELECT mux_asset_id FROM public.videos WHERE id = $1 LIMIT 1`,
      [videoId],
    );

    const assetId = rows[0]?.mux_asset_id;
    if (!assetId) {
      throw new HttpError(404, { message: 'Video not found or missing mux_asset_id' });
    }

    // 2) Mux: retrieve asset da dobiješ tracks
    const assetJson = await muxGetAsset(assetId);
    const tracks = assetJson?.data?.tracks || [];

    // 3) Nađi subtitle/captions text track za dati jezik
    const existingLangTrack =
      tracks.find(
        (t) =>
          t.type === 'text' &&
          (t.text_type === 'subtitles' || t.text_type === 'captions') &&
          String(t.language_code || '').toLowerCase() === lang,
      ) || null;

    if (!existingLangTrack?.id) {
      throw new HttpError(404, {
        message: 'Subtitle track for this language does not exist',
        lang,
        video_id: videoId,
        mux_asset_id: assetId,
      });
    }

    const trackId = existingLangTrack.id;

    // 4) Obriši track
    await muxDeleteTrack(assetId, trackId);

    return {
      message: 'Subtitle track deleted',
      lang,
      video_id: videoId,
      mux_asset_id: assetId,
      deleted_track_id: trackId,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('delete subtitle error:', err);

    const msg = String(err?.message || '');
    if (msg.startsWith('MUX_')) {
      throw new HttpError(502, { message: 'Mux error', details: msg });
    }

    throw new HttpError(500, { message: 'Server error' });
  }
}
