import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

function prerequisites(object, userId) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid video ID'),

    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    is_active: z.boolean().optional(),

    time_limit_seconds: z.coerce.number().int().min(1).nullable().optional(),
    question_count: z.coerce.number().int().min(1).optional(),
    max_attempts: z.coerce.number().int().min(1).nullable().optional(),

    passing_score_percentage: z.coerce.number().min(0).max(100).optional(),
    shuffle_questions: z.boolean().optional(),
    shuffle_options: z.boolean().optional(),
    answer_review_mode: z.enum(['immediate', 'at_end']).optional(),
  });


  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }
  
  return validateOrThrow(schema.safeParse(object));
}

function hasField(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
}

export async function updateQuizInternal(object, userId = null) {
  const data = prerequisites(object, userId);

  await assertQuizOwner(data.quizId, userId);

  const { rows } = await writePool.query(
    `
      UPDATE quizzes
      SET
        title = CASE WHEN $2 THEN $3 ELSE title END,
        description = CASE WHEN $4 THEN $5 ELSE description END,
        is_active = CASE WHEN $6 THEN $7 ELSE is_active END,
        time_limit_seconds = CASE WHEN $8 THEN $9 ELSE time_limit_seconds END,
        question_count = CASE WHEN $10 THEN $11 ELSE question_count END,
        max_attempts = CASE WHEN $12 THEN $13 ELSE max_attempts END,
        passing_score_percentage = CASE WHEN $14 THEN $15 ELSE passing_score_percentage END,
        shuffle_questions = CASE WHEN $16 THEN $17 ELSE shuffle_questions END,
        shuffle_options = CASE WHEN $18 THEN $19 ELSE shuffle_options END,
        answer_review_mode = CASE WHEN $20 THEN $21 ELSE answer_review_mode END
      WHERE id = $1
      RETURNING *
    `,
    [
      data.quizId,

      hasField(data, 'title'),
      data.title,

      hasField(data, 'description'),
      data.description,

      hasField(data, 'is_active'),
      data.is_active,

      hasField(data, 'time_limit_seconds'),
      data.time_limit_seconds,

      hasField(data, 'question_count'),
      data.question_count,

      hasField(data, 'max_attempts'),
      data.max_attempts,

      hasField(data, 'passing_score_percentage'),
      data.passing_score_percentage,

      hasField(data, 'shuffle_questions'),
      data.shuffle_questions,

      hasField(data, 'shuffle_options'),
      data.shuffle_options,

      hasField(data, 'answer_review_mode'),
      data.answer_review_mode,
    ]
  );

  return rows[0] || null;
}
