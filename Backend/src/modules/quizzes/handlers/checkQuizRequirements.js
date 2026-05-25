import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object, userId) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quiz ID'),
    userId: z.string().uuid('Invalid user ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

export async function checkQuizRequirementsInternal(object, userId = null) {
  const { quizId, userId: validatedUserId } = prerequisites(object, userId);

  const { rows } = await readPool.query(
    `
      WITH quiz_exists AS (
        SELECT 1
        FROM quizzes
        WHERE id = $1
          AND is_active = true
        LIMIT 1
      ),
      rule_check AS (
        SELECT
          BOOL_AND(
            CASE
              WHEN qar.rule_type = 'video_watch_percentage' THEN
                COALESCE(wp.percentage_watched, 0) >= qar.required_percentage
              WHEN qar.rule_type = 'video_watch_seconds' THEN
                COALESCE(wp.progress_seconds, 0) >= qar.required_seconds
              ELSE false
            END
          ) AS has_met_requirements
        FROM quiz_access_rules qar
        LEFT JOIN watch_progress wp
          ON wp.user_id = $2
         AND wp.video_id = qar.video_id
        WHERE qar.quiz_id = $1
          AND qar.is_active = true
          AND qar.rule_type IN ('video_watch_percentage', 'video_watch_seconds')
      )
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 FROM quiz_exists) THEN
            COALESCE((SELECT has_met_requirements FROM rule_check), true)
          ELSE false
        END AS has_met_requirements;
    `,
    [quizId, validatedUserId]
  );

  return Boolean(rows[0]?.has_met_requirements);
}
