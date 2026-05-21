import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

function prerequisites(object) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quiz ID'),

    source_type: z.enum([
      'playlist',
      'video',
      'general',
      'manual'
    ], 'Invalid source type'),

    playlist_id: z.string().uuid('Invalid playlist ID').optional().nullable(),
    video_id: z.string().uuid('Invalid video ID').optional().nullable(),

    percentage: z.coerce.number().min(0).max(100).optional().nullable(),
    fixed_question_count: z.coerce.number().int().min(1).optional().nullable(),

    include_general_questions: z.boolean().optional().default(false),
  });

  const data = validateOrThrow(schema.safeParse(object));

  if (data.percentage == null && data.fixed_question_count == null) {
    const error = new Error('Either percentage or fixed_question_count is required.');
    error.status = 400;
    throw error;
  }

  if (data.percentage != null && data.fixed_question_count != null) {
    const error = new Error('Send either percentage or fixed_question_count, not both.');
    error.status = 400;
    throw error;
   }

  if (data.source_type === 'playlist' && !data.playlist_id) {
    const error = new Error('playlist_id is required for playlist source.');
    error.status = 400;
    throw error;
  }

  if (data.source_type === 'video' && !data.video_id) {
    const error = new Error('video_id is required for video source.');
    error.status = 400;
    throw error;
  }

  if (data.source_type === 'general') {
    data.playlist_id = null;
    data.video_id = null;
  }

  if (data.source_type === 'manual') {
    data.playlist_id = null;
    data.video_id = null;
  }

  return data;
}

export async function createQuizQuestionSourceInternal(object, userId) {
  const {
    quizId,
    source_type,
    playlist_id,
    video_id,
    percentage,
    fixed_question_count,
    include_general_questions,
  } = prerequisites(object);

  await assertQuizOwner(quizId, userId);

  const { rows } = await writePool.query(
    `
      INSERT INTO quiz_question_sources (
        quiz_id,
        source_type,
        playlist_id,
        video_id,
        percentage,
        fixed_question_count,
        include_general_questions
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `,
    [
      quizId,
      source_type,
      playlist_id || null,
      video_id || null,
      percentage ?? null,
      fixed_question_count ?? null,
      include_general_questions,
    ]
  );

  return rows[0] || null;
}