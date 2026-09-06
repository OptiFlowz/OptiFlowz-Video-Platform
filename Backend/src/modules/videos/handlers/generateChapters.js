import { readPool } from '../../../database/index.js';
import { generateChapters } from '@mux/ai/workflows';
import { HttpError } from '../../../common/httpError.js';

export async function generateChaptersInternal({ body: inputBody }) {
  try {
    const { videoId, languageCode } = inputBody;

    if (!videoId) {
      throw new HttpError(400, { success: false, message: 'Missing videoId' });
    }

    const lang = String(languageCode || 'en')
      .trim()
      .toLowerCase();
    if (!lang) {
      throw new HttpError(400, { success: false, message: 'Invalid languageCode' });
    }

    // 1) Uzmi mux_asset_id iz baze za dati video
    const videoRes = await readPool.query(
      `SELECT mux_asset_id
       FROM videos
       WHERE id = $1
       LIMIT 1`,
      [videoId],
    );

    if (videoRes.rowCount === 0) {
      throw new HttpError(404, { success: false, message: 'Video not found' });
    }

    const assetId = videoRes.rows[0]?.mux_asset_id;

    if (!assetId) {
      throw new HttpError(400, { success: false, message: 'Video has no mux_asset_id' });
    }

    // 2) Generiši chapters preko assetId + lang
    const result = await generateChapters(assetId, lang, { provider: 'openai' });

    const chapters = result?.chapters;
    if (!Array.isArray(chapters)) {
      throw new HttpError(500, { success: false, message: 'Invalid generateChapters result' });
    }

    // 3) (opciono) Upisi chapters nazad u isti video
    // await pool.query(
    //   `UPDATE videos
    //    SET chapters = $1::jsonb,
    //        updated_at = NOW()
    //    WHERE id = $2`,
    //   [JSON.stringify(chapters), videoId]
    // );

    return { chapters, success: true, message: 'OK' };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, { success: false, message: err.message || 'Internal server error' });
  }
}
