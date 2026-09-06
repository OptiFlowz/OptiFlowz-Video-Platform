import { writePool } from '../../../database/index.js';
import { muxBasicAuthHeader } from '../helpers/videoModeration.shared.js';
import { HttpError } from '../../../common/httpError.js';

export async function deleteVideoInternal({ params: routeParams }) {
  try {
    const { videoId } = routeParams;

    // 1) uzmi mux_asset_id iz baze
    const { rows } = await writePool.query(
      `SELECT mux_asset_id
       FROM public.videos
       WHERE id = $1
       LIMIT 1`,
      [videoId],
    );

    if (!rows.length) {
      throw new HttpError(404, { message: 'Video not found' });
    }

    const muxAssetId = rows[0]?.mux_asset_id;
    if (!muxAssetId) {
      throw new HttpError(400, { message: 'Video has no mux_asset_id' });
    }

    // 2) obriši asset na Mux-u (asinkrono, webhook će posle obrisati DB)
    const muxResp = await fetch(`https://api.mux.com/video/v1/assets/${muxAssetId}`, {
      method: 'DELETE',
      headers: {
        Authorization: muxBasicAuthHeader(),
        'Content-Type': 'application/json',
      },
    });

    // Mux često vraća 204, može i 200, a 404 tretiraj kao "već obrisano"
    if (!muxResp.ok && muxResp.status !== 404) {
      const txt = await muxResp.text().catch(() => '');
      throw new HttpError(502, {
        message: 'Mux API error (delete asset)',
        status: muxResp.status,
        details: txt?.slice(0, 500),
      });
    }

    // 3) ne brišemo DB ovde — webhook video.asset.deleted će odraditi brisanje + cascade
    return {
      success: true,
      video_id: videoId,
      mux_asset_id: muxAssetId,
      message: 'Delete requested on Mux. DB will be cleaned by webhook.',
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('delete video route error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
