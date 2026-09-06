import { z } from 'zod';
import {
  R2_PUBLIC_BASE_URL,
  extractKeyFromPublicUrl,
  s3,
  R2_BUCKET,
} from '../helpers/videoModeration.shared.js';
import { writePool } from '../../../database/index.js';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { HttpError } from '../../../common/httpError.js';

const fileSchema = z.object({
  mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});

export async function videoThumbnailUploadInternal({ params: routeParams, file: uploadedFile }) {
  try {
    const videoId = routeParams.videoId;
    if (!videoId) {
      throw new HttpError(400, { message: 'Missing videoId' });
    }

    if (!R2_PUBLIC_BASE_URL) {
      throw new HttpError(500, {
        message: 'R2_PUBLIC_BASE_URL is not set',
      });
    }

    // 1) Učitaj stari thumbnail_url iz baze
    const existing = await writePool.query(
      `SELECT thumbnail_url FROM public.videos WHERE id = $1 LIMIT 1`,
      [videoId],
    );

    if (!existing.rowCount) {
      throw new HttpError(404, { message: 'Video not found' });
    }

    const oldUrl = existing.rows[0]?.thumbnail_url || null;
    const oldKey = extractKeyFromPublicUrl(oldUrl);

    // Ako fajl NIJE poslat -> ukloni thumbnail
    if (!uploadedFile) {
      const upd = await writePool.query(
        `
        UPDATE public.videos
        SET thumbnail_url = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING id, thumbnail_url
        `,
        [videoId],
      );

      if (oldKey) {
        try {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: R2_BUCKET,
              Key: oldKey,
            }),
          );
        } catch (e) {
          console.warn('Video thumbnail delete failed:', e?.message || e);
        }
      }

      return { success: true, video: upd.rows[0] };
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

    // 3) Obrada slike
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
    const newKey = `video-thumbnails/${videoId}/${randomUUID()}.webp`;
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
      UPDATE public.videos
      SET thumbnail_url = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, thumbnail_url
      `,
      [videoId, newUrl],
    );

    // 6) Obriši stari thumbnail (best-effort)
    if (oldKey) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: R2_BUCKET,
            Key: oldKey,
          }),
        );
      } catch (e) {
        console.warn('Old video thumbnail delete failed:', e?.message || e);
      }
    }

    return { success: true, video: upd.rows[0] };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('Video thumbnail upload error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
