import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    videoId: z.string().uuid('Invalid video ID'),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function getVideoQuizInternal(object, userId = null) {
  const { videoId } = prerequisites(object);

  const { rows } = await readPool.query(
    `
      SELECT vq.*
      FROM video_quizzes vq
      LEFT JOIN videos v ON v.id = vq.video_id
      WHERE vq.video_id = $1
        AND (
          vq.is_active = true
          OR ($2::uuid IS NOT NULL AND v.uploaded_by = $2::uuid)
        )
      LIMIT 1
    `,
    [videoId, userId]
  );

  return rows[0] || null;
}