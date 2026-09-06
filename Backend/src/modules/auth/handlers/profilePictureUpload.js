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
    .max(4 * 1024 * 1024),
});

function extractKeyFromPublicUrl(url) {
  if (!url || !R2_PUBLIC_BASE_URL) return null;
  if (!url.startsWith(R2_PUBLIC_BASE_URL + '/')) return null;
  return url.slice((R2_PUBLIC_BASE_URL + '/').length);
}

export async function profilePictureUploadInternal({ file: uploadedFile }, actorUserId = null) {
  try {
    const userId = actorUserId || null;
    if (!userId) throw new HttpError(401, { message: 'Unauthorized' });

    // 1) Učitaj staru sliku iz baze (treba nam i za upload i za delete)
    const { rows: existingRows } = await writePool.query(
      'SELECT image_url FROM public.users WHERE id = $1',
      [userId],
    );

    const oldUrl = existingRows[0]?.image_url || null;
    const oldKey = extractKeyFromPublicUrl(oldUrl);

    // ✅ Ako fajl NE postoji -> tretiraj kao "remove profile picture"
    if (!uploadedFile) {
      // prvo null u bazi
      const { rows } = await writePool.query(
        `
          UPDATE public.users
          SET image_url = NULL, updated_at = NOW()
          WHERE id = $1
          RETURNING image_url
          `,
        [userId],
      );

      // onda best-effort brisanje iz R2 (DeleteObject je idempotent; ako ne postoji, uglavnom je OK)
      if (oldKey) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey }));
        } catch (e) {
          console.warn('Profile picture delete failed:', e?.message || e);
        }
      }

      return rows[0];
    }

    // 2) Validacija fajla (samo kad postoji)
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

    if (!R2_PUBLIC_BASE_URL) {
      throw new HttpError(500, {
        message:
          'R2_PUBLIC_BASE_URL is not set. Set it to your r2.dev public bucket URL or your custom domain base URL.',
      });
    }

    const inputBuffer = uploadedFile.buffer;

    // Resize + convert to webp
    const targetSize = 512;
    const compressedBuffer = await sharp(inputBuffer)
      .rotate()
      .resize({
        width: targetSize,
        height: targetSize,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();

    const newKey = `profile-pictures/${userId}/${randomUUID()}.webp`;
    const newUrl = `${R2_PUBLIC_BASE_URL}/${newKey}`;

    // 3) Upload u R2
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: newKey,
        Body: compressedBuffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    // 4) Updejtuj bazu
    const { rows } = await writePool.query(
      `
        UPDATE public.users
        SET image_url = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING image_url
        `,
      [newUrl, userId],
    );

    // 5) Obriši staru sliku (best-effort)
    if (oldKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey }));
      } catch (e) {
        console.warn('Old profile picture delete failed:', e?.message || e);
      }
    }

    return rows[0];
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('Profile picture upload error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
