import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { s3 } from '../../storage/r2.client.js';
import { collectionIdSchema, requireCollectionUser } from '../helpers/collections.validation.js';
import { lockCollection, updateCollectionThumbnail } from '../repository/collections.repository.js';

const fileSchema = z.object({
  mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive().max(5 * 1024 * 1024),
  buffer: z.instanceof(Buffer).refine(buffer => buffer.length > 0 && buffer.length <= 5 * 1024 * 1024),
});

async function deleteThumbnail(bucket, key) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(10000) });
  } catch {
    console.warn('Collection thumbnail cleanup failed');
  }
}

export async function collectionThumbnailUploadInternal({ params, file }, userId, access) {
  requireCollectionUser(userId);
  const { collectionId } = validateOrThrow(collectionIdSchema.safeParse(params));
  let image;
  if (file) {
    if (!fileSchema.safeParse(file).success) throw new HttpError(400, { message: 'Invalid file' });
    try {
      const input = sharp(file.buffer);
      const metadata = await input.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Unsupported image format');
      image = await input.rotate()
        .resize({ width: 1280, height: 720, fit: 'cover', position: 'center' })
        .webp({ quality: 82 }).toBuffer();
    } catch {
      throw new HttpError(400, { message: 'Invalid image' });
    }
  }
  const baseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const bucket = process.env.R2_BUCKET;
  if (!baseUrl || !bucket) throw new HttpError(500, { message: 'R2 storage is not configured' });

  const prefix = `collection-thumbnails/${collectionId}/`;
  const client = await writePool.connect();
  let newKey, oldKey, collection;
  let commitStarted = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // Serialize replacements with other collection writes and recheck ownership under the lock.
    const current = await lockCollection(client, collectionId, userId, access?.canAccessAny === true);
    if (!current) throw new HttpError(404, { message: 'Collection not found' });
    if (current.thumbnail_url?.startsWith(`${baseUrl}/${prefix}`)) {
      oldKey = current.thumbnail_url.slice(baseUrl.length + 1);
    }
    let newUrl = null;
    if (image) {
      newKey = `${prefix}${randomUUID()}.webp`;
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: newKey, Body: image,
        ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable',
      }), { abortSignal: AbortSignal.timeout(10000) });
      newUrl = `${baseUrl}/${newKey}`;
    }
    collection = await updateCollectionThumbnail(client, collectionId, newUrl);
    commitStarted = true;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // A failed COMMIT response can have an unknown outcome; retain both files in that case.
    if (newKey && !commitStarted) await deleteThumbnail(bucket, newKey);
    throw error;
  } finally { client.release(); }

  if (oldKey) await deleteThumbnail(bucket, oldKey);
  return collection;
}
