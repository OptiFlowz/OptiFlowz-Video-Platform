import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

function prerequisites(object) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quiz ID'),
    rule_type: z.enum([
      'video_watch_percentage',
      'video_watch_seconds',
      'playlist_watch_percentage',
      'quiz_passed',
      'manual'
    ], 'Invalid rule type'),
    video_id: z.string().uuid('Invalid video ID').optional(),
    playlist_id: z.string().uuid('Invalid playlist ID').optional(),
    required_quiz_id: z.string().uuid('Invalid required quiz ID').optional(),
    required_percentage: z.number().min(0).max(100).optional(),
    required_seconds: z.number().int().optional(),
    is_active: z.boolean().default(true)
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function createQuizAccessRuleInternal(object, userId) {
  const {
    quizId,
    rule_type,
    video_id,
    playlist_id,
    required_quiz_id,
    required_percentage,
    required_seconds,
    is_active
  } = prerequisites(object);
  await assertQuizOwner(quizId,userId);
  

  // Build SQL query based on the rule type
  const queryParams = [quizId, rule_type, is_active];
  let queryText = `
    INSERT INTO quiz_access_rules (
      quiz_id, rule_type, is_active
  `;

  // Add conditional fields based on ruleType
  if (rule_type === 'video_watch_percentage' || rule_type === 'video_watch_seconds') {
    queryText += `, video_id, required_percentage, required_seconds`;
    queryParams.push(video_id, required_percentage, required_seconds);
  } else if (rule_type === 'playlist_watch_percentage') {
    queryText += `, playlist_id, required_percentage`;
    queryParams.push(playlist_id, required_percentage);
  } else if (rule_type === 'quiz_passed') {
    queryText += `, required_quiz_id`;
    queryParams.push(required_quiz_id);
  }

  queryText += ') VALUES (';
  queryText += queryParams.map((_, index) => `$${index + 1}`).join(', ');
  queryText += ') RETURNING *;';

  const { rows } = await writePool.query(queryText, queryParams);

  return rows[0] || null;
}