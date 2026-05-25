import { readPool } from '../../../database/index.js';
import {
  buildVideoCardSelect,
  buildVideoCardJoins,
  buildVideoCardVisibilityWhere,
} from '../../../database/sql/videoCardFragments.js';
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

export async function getQuizRequirementVideosInternal(object, userId = null) {
  const { quizId, userId: validatedUserId } = prerequisites(object, userId);

  const query = `
    ${buildVideoCardSelect({ includeWatchProgress: true })},
      qar.id AS rule_id,
      qar.rule_type,
      qar.required_percentage::float AS required_percentage,
      qar.required_seconds,
      COALESCE(wp.total_watch_seconds, 0) AS total_watch_seconds,
      CASE
        WHEN COALESCE(v.duration_seconds, 0) <= 0 THEN 0
        ELSE LEAST(
          (COALESCE(wp.total_watch_seconds, 0)::numeric / v.duration_seconds) * 100,
          100
        )::float
      END AS requirement_percentage_watched,
      CASE
        WHEN qar.rule_type = 'video_watch_percentage' THEN
          GREATEST(
            qar.required_percentage -
              CASE
                WHEN COALESCE(v.duration_seconds, 0) <= 0 THEN 0
                ELSE LEAST(
                  (COALESCE(wp.total_watch_seconds, 0)::numeric / v.duration_seconds) * 100,
                  100
                )
              END,
            0
          )::float
        ELSE NULL
      END AS missing_percentage,
      CASE
        WHEN qar.rule_type = 'video_watch_seconds' THEN
          GREATEST(qar.required_seconds - COALESCE(wp.total_watch_seconds, 0), 0)
        WHEN qar.rule_type = 'video_watch_percentage' THEN
          GREATEST(
            CEIL((qar.required_percentage / 100) * COALESCE(v.duration_seconds, 0))
              - COALESCE(wp.total_watch_seconds, 0),
            0
          )::int
        ELSE NULL
      END AS missing_seconds,
      CASE
        WHEN qar.rule_type = 'video_watch_percentage' THEN
          CASE
            WHEN COALESCE(v.duration_seconds, 0) <= 0 THEN false
            ELSE
              (COALESCE(wp.total_watch_seconds, 0)::numeric / v.duration_seconds) * 100
              >= qar.required_percentage
          END
        WHEN qar.rule_type = 'video_watch_seconds' THEN
          COALESCE(wp.total_watch_seconds, 0) >= qar.required_seconds
        ELSE false
      END AS has_met_requirement
    ${buildVideoCardJoins({
      includeWatchProgress: true,
      watchProgressUserParam: '$2',
    })}
    JOIN quiz_access_rules qar
      ON qar.video_id = v.id
    WHERE
      ${buildVideoCardVisibilityWhere()}
      AND qar.quiz_id = $1
      AND qar.is_active = true
      AND qar.rule_type IN ('video_watch_percentage', 'video_watch_seconds')
    ORDER BY qar.id;
  `;

  const { rows } = await readPool.query(query, [quizId, validatedUserId]);

  return rows;
}
