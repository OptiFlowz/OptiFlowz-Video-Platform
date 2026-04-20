import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';

import { s3 } from '../../storage/r2.client.js';
import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';

const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

function extractKeyFromPublicUrl(url) {
  if (!url || !R2_PUBLIC_BASE_URL) return null;
  if (!url.startsWith(R2_PUBLIC_BASE_URL + '/')) return null;
  return url.slice((R2_PUBLIC_BASE_URL + '/').length);
}

function prerequisites(params, userId) {
  const schema = z.object({
    personId: z.string().uuid('Invalid person ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse(params));
}

export async function deletePersonInternal(params, userId) {
  const { personId } = prerequisites(params, userId);

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

  await writePool.query(
    `
      DELETE FROM public.people
      WHERE id = $1
    `,
    [personId]
  );

  if (oldKey && R2_BUCKET) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: oldKey,
        })
      );
    } catch (e) {
      console.warn('Person image delete failed:', e?.message || e);
    }
  }

  return { deleted: true };
}