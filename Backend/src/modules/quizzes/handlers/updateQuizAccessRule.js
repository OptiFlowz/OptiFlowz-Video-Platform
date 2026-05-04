import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

function prerequisites(object) {
  const schema = z.object({
    rule_type: z.enum([
      'video_watch_percentage',
      'video_watch_seconds',
      'playlist_watch_percentage',
      'quiz_passed',
      'manual'
    ], 'Invalid rule type'),
    video_id: z.string().uuid('Invalid video ID').optional().nullable(),
    playlist_id: z.string().uuid('Invalid playlist ID').optional().nullable(),
    required_quiz_id: z.string().uuid('Invalid required quiz ID').optional().nullable(),
    required_percentage: z.number().min(0).max(100).optional().nullable(),
    required_seconds: z.number().int().optional().nullable(),
    is_active: z.boolean().default(true)
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function updateQuizAccessRuleInternal(object, userId) {
  const { ruleId } = object;  
  const {
    rule_type,
    video_id,
    playlist_id,
    required_quiz_id,
    required_percentage,
    required_seconds,
    is_active
  } = prerequisites(object);

  const { rows: ruleRows } = await writePool.query(
    `SELECT quiz_id FROM quiz_access_rules WHERE id = $1 LIMIT 1;`,
    [ruleId]
  );

  if (ruleRows.length === 0) {
    throw new Error('Rule not found.');
  }

  const quizId = ruleRows[0].quiz_id;
  await assertQuizOwner(quizId, userId); 
  
   const queryParams = [];
  let queryText = `
    UPDATE quiz_access_rules
    SET
  `;

  // Conditional updates based on the provided data
  const fieldsToUpdate = [];
  if (rule_type) {
    fieldsToUpdate.push(`rule_type = $${queryParams.length + 1}`);
    queryParams.push(rule_type);
  }
  if (video_id) {
    fieldsToUpdate.push(`video_id = $${queryParams.length + 1}`);
    queryParams.push(video_id);
  }
  if (playlist_id) {
    fieldsToUpdate.push(`playlist_id = $${queryParams.length + 1}`);
    queryParams.push(playlist_id);
  }
  if (required_quiz_id) {
    fieldsToUpdate.push(`required_quiz_id = $${queryParams.length + 1}`);
    queryParams.push(required_quiz_id);
  }
  if (required_percentage !== undefined) {
    fieldsToUpdate.push(`required_percentage = $${queryParams.length + 1}`);
    queryParams.push(required_percentage);
  }
  if (required_seconds !== undefined) {
    fieldsToUpdate.push(`required_seconds = $${queryParams.length + 1}`);
    queryParams.push(required_seconds);
  }
  if (is_active !== undefined) {
    fieldsToUpdate.push(`is_active = $${queryParams.length + 1}`);
    queryParams.push(is_active);
  }

  // If no fields were provided to update, throw an error
  if (fieldsToUpdate.length === 0) {
    throw new Error('No fields to update');
  }

  queryText += fieldsToUpdate.join(', ') + ` WHERE id = $${queryParams.length + 1} RETURNING *;`;
  queryParams.push(ruleId);  // Add ruleId to the end for WHERE clause

  const { rows } = await writePool.query(queryText, queryParams);

  return rows[0] || null;
}