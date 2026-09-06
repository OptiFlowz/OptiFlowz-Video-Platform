import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { s3 } from '../../storage/r2.client.js';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { HttpError } from '../../../common/httpError.js';

const R2_BUCKET = process.env.R2_BUCKET;

const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const fileSchema = z.object({
  mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});

function extractKeyFromPublicUrl(url) {
  if (!url || !R2_PUBLIC_BASE_URL) return null;
  if (!url.startsWith(R2_PUBLIC_BASE_URL + '/')) return null;
  return url.slice((R2_PUBLIC_BASE_URL + '/').length);
}

export async function playlistThumbnailUploadInternal({ params: routeParams, file: uploadedFile }) {
  try {
    const playlistId = routeParams.playlistId;
    if (!playlistId) throw new HttpError(400, { message: 'Missing playlistId' });

    if (!R2_PUBLIC_BASE_URL) {
      throw new HttpError(500, {
        message: 'R2_PUBLIC_BASE_URL is not set',
      });
    }

    // 1) Učitaj stari thumbnail_url iz baze
    const existing = await writePool.query(
      `SELECT thumbnail_url FROM public.playlists WHERE id = $1 LIMIT 1`,
      [playlistId],
    );

    if (!existing.rowCount) {
      throw new HttpError(404, { message: 'Playlist not found' });
    }

    const oldUrl = existing.rows[0]?.thumbnail_url || null;
    const oldKey = extractKeyFromPublicUrl(oldUrl);

    // ✅ Ako fajl NIJE poslat -> remove thumbnail
    if (!uploadedFile) {
      const upd = await writePool.query(
        `
        UPDATE public.playlists
        SET thumbnail_url = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING id, thumbnail_url
        `,
        [playlistId],
      );

      if (oldKey) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey }));
        } catch (e) {
          console.warn('Playlist thumbnail delete failed:', e?.message || e);
        }
      }

      return { success: true, playlist: upd.rows[0] };
    }

    // 2) Validacija fajla
    const parsedFile = fileSchema.safeParse({
      mimetype: uploadedFile.mimetype,
      size: uploadedFile.size,
    });
    if (!parsedFile.success) {
      throw new HttpError(400, {
        message: 'Invalid file',
        errors: parsedFile.error.flatten(),
      });
    }

    // 3) Obrada slike (thumbnail je obično 16:9)
    //    - cover: napravi lep crop
    //    - 1280x720 je super za thumbnails
    const inputBuffer = uploadedFile.buffer;

    const compressedBuffer = await sharp(inputBuffer)
      .rotate()
      .resize({
        width: 1280,
        height: 720,
        fit: 'cover',
        position: 'center',
      })
      .webp({ quality: 82 })
      .toBuffer();

    // 4) Upload u R2
    const newKey = `playlist-thumbnails/${playlistId}/${randomUUID()}.webp`;
    const newUrl = `${R2_PUBLIC_BASE_URL}/${newKey}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: newKey,
        Body: compressedBuffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    // 5) Update DB
    const upd = await writePool.query(
      `
      UPDATE public.playlists
      SET thumbnail_url = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, thumbnail_url
      `,
      [playlistId, newUrl],
    );

    // 6) Obriši stari thumbnail (best-effort)
    if (oldKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey }));
      } catch (e) {
        console.warn('Old playlist thumbnail delete failed:', e?.message || e);
      }
    }

    return { success: true, playlist: upd.rows[0] };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('Playlist thumbnail upload error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
