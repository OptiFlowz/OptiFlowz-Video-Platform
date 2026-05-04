import { writePool } from '../../../database/index.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

export async function deleteQuizAccessRuleInternal(ruleId, userId) {
  // Prvo proveravamo da li korisnik ima pravo da obriše ovo pravilo
  const { rows } = await writePool.query(
    'SELECT quiz_id FROM quiz_access_rules WHERE id = $1 LIMIT 1;',
    [ruleId]
  );

  if (rows.length === 0) {
    throw new Error('Quiz access rule not found');
  }

  const quizId = rows[0].quiz_id;

  // Verifikacija da li je korisnik vlasnik kviza
  await assertQuizOwner(quizId, userId);

  // Brisanje pravila iz baze
  await writePool.query(
    'DELETE FROM quiz_access_rules WHERE id = $1;',
    [ruleId]
  );
}