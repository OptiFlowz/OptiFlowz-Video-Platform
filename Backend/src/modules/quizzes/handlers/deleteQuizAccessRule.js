import { writePool } from '../../../database/index.js';

export async function deleteQuizAccessRuleInternal(ruleId, userId) {
  // The route authorizes the rule; retain the existence check before deletion.
  const { rows } = await writePool.query(
    'SELECT quiz_id FROM quiz_access_rules WHERE id = $1 LIMIT 1;',
    [ruleId]
  );

  if (rows.length === 0) {
    throw new Error('Quiz access rule not found');
  }

  // Brisanje pravila iz baze
  await writePool.query(
    'DELETE FROM quiz_access_rules WHERE id = $1;',
    [ruleId]
  );
}
