import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertVideoOwner } from '../../../common/videoOwnership.js';

function prerequisites(object, userId) {
  const schema = z.object({
    videoId: z.string().uuid('Invalid video ID'),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function deleteVideoQuizInternal(object, userId = null) {
  const { videoId } = prerequisites(object, userId);
  await assertVideoOwner(videoId, userId);

  const { rowCount } = await writePool.query(
    `DELETE FROM video_quizzes WHERE video_id = $1`,
    [videoId]
  );

  return rowCount > 0;
}
