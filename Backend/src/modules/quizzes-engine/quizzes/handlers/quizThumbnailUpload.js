import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { z } from 'zod';
import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { s3 } from '../../../storage/r2.client.js';
import { quizIdSchema, requireQuizUser } from '../helpers/quizzes.validation.js';
import { lockQuizThumbnail, updateQuizThumbnail } from '../repository/quizzes.repository.js';

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
    console.warn('Quiz thumbnail cleanup failed');
  }
}

// ownerId is the authorized quiz owner resolved by requireQuizResourceAccess,
// including when a user with update_any manages somebody else's quiz.
export async function quizThumbnailUploadInternal({ params, file }, ownerId) {
  requireQuizUser(ownerId);
  const parsed = validateOrThrow(quizIdSchema.safeParse(params));
  const quizId = parsed.quizId.toLowerCase();
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

  const prefix = `quiz-thumbnails/${quizId}/`;
  const client = await writePool.connect();
  let newKey, oldKey, quiz;
  let commitStarted = false;
  try {
    await client.query('BEGIN');
    // Serialize replacements and recheck the owner before uploading or deleting.
    const current = await lockQuizThumbnail(client, quizId, ownerId);
    if (!current) throw new HttpError(404, { message: 'Quiz not found' });
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
    quiz = await updateQuizThumbnail(client, quizId, newUrl);
    commitStarted = true;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // A lost COMMIT response has an unknown outcome: keep both objects then.
    if (newKey && !commitStarted) await deleteThumbnail(bucket, newKey);
    throw error;
  } finally { client.release(); }

  if (oldKey) await deleteThumbnail(bucket, oldKey);
  return quiz;
}
