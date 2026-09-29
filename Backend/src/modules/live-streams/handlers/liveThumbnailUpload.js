import { randomUUID } from 'node:crypto';
import { CopyObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { s3 } from '../../storage/r2.client.js';

const idSchema = z.string().uuid('Invalid live stream ID');
const fileSchema = z.object({
  mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive().max(5 * 1024 * 1024),
});

export async function liveThumbnailUploadInternal({ params, file }, userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
  const id = validateOrThrow(idSchema.safeParse(params.liveStreamId));
  if (file && !fileSchema.safeParse(file).success) {
    throw new HttpError(400, { message: 'Invalid file' });
  }
  const baseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const bucket = process.env.R2_BUCKET;
  if (!baseUrl || !bucket) throw new HttpError(500, { message: 'R2 storage is not configured' });

  const client = await writePool.connect();
  let newKey;
  const newKeys = [];
  const oldKeys = new Set();
  let commitStarted = false;
  try {
    await client.query('BEGIN');
    // Serialize replacement with recording copies and livestream deletion.
    const { rows } = await client.query(`SELECT thumbnail_url FROM public.live_streams
      WHERE id=$1 AND user_id=$2 FOR UPDATE`, [id, userId]);
    if (!rows[0]) throw new HttpError(404, { message: 'Live stream not found' });
    const oldUrl = rows[0].thumbnail_url;
    if (oldUrl?.startsWith(`${baseUrl}/live-stream-thumbnails/${id}/`)) {
      oldKeys.add(oldUrl.slice(baseUrl.length + 1));
    }
    const recordings = await client.query(`SELECT id, thumbnail_url FROM public.videos
      WHERE live_stream_id=$1 AND mux_status='preparing' ORDER BY id FOR UPDATE`, [id]);
    let newUrl = null;
    if (file) {
      let image;
      try {
        image = await sharp(file.buffer).rotate()
          .resize({ width: 1280, height: 720, fit: 'cover', position: 'center' })
          .webp({ quality: 82 }).toBuffer();
      } catch {
        throw new HttpError(400, { message: 'Invalid image' });
      }
      newKey = `live-stream-thumbnails/${id}/${randomUUID()}.webp`;
      newKeys.push(newKey);
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: newKey, Body: image,
        ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable',
      }), { abortSignal: AbortSignal.timeout(10000) });
      newUrl = `${baseUrl}/${newKey}`;
    }
    const updated = await client.query(`UPDATE public.live_streams
      SET thumbnail_url=$2, updated_at=now() WHERE id=$1 RETURNING id, thumbnail_url`, [id, newUrl]);
    for (const recording of recordings.rows) {
      let recordingUrl = null;
      if (newKey) {
        const copyKey = `video-thumbnails/${recording.id}/${randomUUID()}.webp`;
        newKeys.push(copyKey);
        await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: copyKey,
          CopySource: `${bucket}/${newKey}`.split('/').map(encodeURIComponent).join('/'),
        }), { abortSignal: AbortSignal.timeout(10000) });
        recordingUrl = `${baseUrl}/${copyKey}`;
      }
      await client.query(`UPDATE public.videos SET thumbnail_url=$2, updated_at=now()
        WHERE id=$1 AND live_stream_id=$3 AND mux_status='preparing'`, [recording.id, recordingUrl, id]);
      if (recording.thumbnail_url?.startsWith(`${baseUrl}/video-thumbnails/${recording.id}/`)) {
        oldKeys.add(recording.thumbnail_url.slice(baseUrl.length + 1));
      }
    }
    commitStarted = true;
    await client.query('COMMIT');

    // Remove replaced objects only after every database update has committed.
    for (const key of oldKeys) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(10000) }).catch(() => console.warn('Old live thumbnail cleanup failed'));
    }
    return { success: true, live_stream: updated.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (!commitStarted) {
      for (const key of newKeys) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }),
          { abortSignal: AbortSignal.timeout(10000) }).catch(() => console.warn('Unused live thumbnail cleanup failed'));
      }
    }
    throw error;
  } finally { client.release(); }
}
