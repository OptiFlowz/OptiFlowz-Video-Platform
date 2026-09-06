import Mux from '@mux/mux-node';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

export async function initiateUploadInternal({ body: inputBody }, actorUserId = null) {
  const userId = actorUserId || null;
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });

  const title = String(inputBody?.title ?? '').trim();
  const languageCode = String(inputBody?.language_code ?? 'en')
    .trim()
    .toLowerCase();
  const languageName = String(inputBody?.language_name ?? 'English').trim();

  if (!title) {
    throw new HttpError(400, { message: 'title is required' });
  }

  // (Opcionalno) minimalna validacija - Mux podržava dosta kodova, ali makar spreči prazno
  if (!languageCode) {
    throw new HttpError(400, { message: 'language_code must be non-empty' });
  }

  const client = await writePool.connect();
  try {
    await client.query('BEGIN');

    const insertSql = `
            INSERT INTO public.videos (title, uploaded_by)
            VALUES ($1, $2)
            RETURNING id
            `;
    const { rows: createdRows } = await client.query(insertSql, [title, userId]);
    const videoId = createdRows[0]?.id;

    // 2) Kreiraj Mux direct upload sa auto captions
    const upload = await mux.video.uploads.create({
      cors_origin: '*',
      new_asset_settings: {
        playback_policies: ['public'],
        encoding_tier: 'baseline',
        normalize_audio: false,
        inputs: [
          {
            generated_subtitles: [
              {
                language_code: languageCode,
                name: languageName,
              },
            ],
          },
        ],

        meta: {
          title,
          external_id: String(videoId),
          creator_id: String(userId),
        },
        passthrough: String(videoId),
      },
    });

    await client.query(`UPDATE public.videos SET mux_upload_id = $1 WHERE id = $2`, [
      upload.id,
      videoId,
    ]);

    await client.query('COMMIT');

    return {
      video_id: videoId,
      upload: {
        upload_id: upload.id,
        upload_url: upload.url,
      },
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    try {
      await client.query('ROLLBACK');
    } catch {}
    console.error('upload initiate error:', err);
    throw new HttpError(500, { message: 'Server error' });
  } finally {
    client.release();
  }
}
