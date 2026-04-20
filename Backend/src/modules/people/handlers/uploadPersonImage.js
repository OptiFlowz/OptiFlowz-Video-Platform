import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';

import { s3 } from '../../storage/r2.client.js';
import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';

const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

export const personImageUploadMiddleware = upload.single('file');

const fileSchema = z.object({
  mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive().max(5 * 1024 * 1024),
});

function extractKeyFromPublicUrl(url) {
  if (!url || !R2_PUBLIC_BASE_URL) return null;
  if (!url.startsWith(R2_PUBLIC_BASE_URL + '/')) return null;
  return url.slice((R2_PUBLIC_BASE_URL + '/').length);
}

function prerequisites(params, file, userId) {
  const paramsSchema = z.object({
    personId: z.string().uuid('Invalid person ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const parsedParams = validateOrThrow(paramsSchema.safeParse(params));

  if (file) {
    const parsedFile = fileSchema.safeParse({
      mimetype: file.mimetype,
      size: file.size,
    });

    validateOrThrow(parsedFile);
  }

  return parsedParams;
}

export async function uploadPersonImageInternal(params, file, userId) {
  const { personId } = prerequisites(params, file, userId);

  if (!R2_BUCKET) {
    const error = new Error('R2_BUCKET is not set');
    error.status = 500;
    throw error;
  }

  if (!R2_PUBLIC_BASE_URL) {
    const error = new Error('R2_PUBLIC_BASE_URL is not set');
    error.status = 500;
    throw error;
  }

  const existing = await writePool.query(
    `
      SELECT id, image_url
      FROM public.people
      WHERE id = $1
      LIMIT 1
    `,
    [personId]
  );

  if (!existing.rowCount) {
    const error = new Error('Person not found');
    error.status = 404;
    throw error;
  }

  const oldUrl = existing.rows[0]?.image_url || null;
  const oldKey = extractKeyFromPublicUrl(oldUrl);

  if (!file) {
    const upd = await writePool.query(
      `
        UPDATE public.people
        SET image_url = NULL
        WHERE id = $1
        RETURNING id, name, description, image_url
      `,
      [personId]
    );

    if (oldKey) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: R2_BUCKET,
            Key: oldKey,
          })
        );
      } catch (e) {
        console.warn('Old person image delete failed:', e?.message || e);
      }
    }

    return upd.rows[0];
  }

  const compressedBuffer = await sharp(file.buffer)
    .rotate()
    .resize({
      width: 800,
      height: 800,
      fit: 'cover',
      position: 'center',
    })
    .webp({ quality: 82 })
    .toBuffer();

  const newKey = `people/${personId}/${randomUUID()}.webp`;
  const newUrl = `${R2_PUBLIC_BASE_URL}/${newKey}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: newKey,
      Body: compressedBuffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );

  const upd = await writePool.query(
    `
      UPDATE public.people
      SET image_url = $2
      WHERE id = $1
      RETURNING id, name, description, image_url
    `,
    [personId, newUrl]
  );

  if (oldKey) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: oldKey,
        })
      );
    } catch (e) {
      console.warn('Old person image delete failed:', e?.message || e);
    }
  }

  return upd.rows[0];
}