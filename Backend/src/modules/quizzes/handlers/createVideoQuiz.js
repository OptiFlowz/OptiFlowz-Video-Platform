import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertVideoOwner } from '../../../common/videoOwnership.js';

function prerequisites(object, userId) {
  const schema = z.object({
    videoId: z.string().uuid('Invalid video ID'),
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).optional().nullable(),
    is_active: z.boolean().optional().default(true),
    time_limit_seconds: z.coerce.number().int().min(1).nullable().optional().default(null),
    question_count: z.coerce.number().int().min(1).max(100).optional().default(10),
    max_attempts: z.coerce.number().int().min(1).nullable().optional().default(null),
    passing_score_percentage: z.coerce.number().min(0).max(100).optional().default(50),
    shuffle_questions: z.boolean().optional().default(true),
    shuffle_options: z.boolean().optional().default(true),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function createVideoQuizInternal(object, userId = null) {
  const data = prerequisites(object, userId);

  await assertVideoOwner(data.videoId, userId);

  const { rows } = await writePool.query(
    `
      INSERT INTO video_quizzes (
        video_id,
        title,
        description,
        is_active,
        time_limit_seconds,
        question_count,
        max_attempts,
        passing_score_percentage,
        shuffle_questions,
        shuffle_options
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `,
    [
      data.videoId,
      data.title || null,
      data.description || null,
      data.is_active,
      data.time_limit_seconds,
      data.question_count,
      data.max_attempts,
      data.passing_score_percentage,
      data.shuffle_questions,
      data.shuffle_options,
    ]
  );

  return rows[0];
}
