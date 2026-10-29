import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { quizResultParamsSchema } from '../helpers/quizAttemptManagement.validation.js';
import { attemptError } from '../helpers/attemptQuestions.js';
import { lockAttemptCreation } from '../repository/quiz-attempts.repository.js';
import { getManagedAttemptParticipant, deleteManagedQuizAttempt } from '../repository/quiz-attempt-management.repository.js';

export async function deleteQuizAttemptInternal(params, ownerId, database = writePool) {
  requireQuizAttemptUser(ownerId);
  const { quizId, attemptId } = validateOrThrow(quizResultParamsSchema.safeParse(params));
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const participantId = await getManagedAttemptParticipant(client, quizId, attemptId, ownerId);
    if (!participantId) throw attemptError(404, 'ATTEMPT_NOT_FOUND', 'Quiz attempt not found');
    // Serialize changes to attempt history with startQuizAttempt's limit/number checks.
    // DELETE also locks the attempt row used by answer writes, submit and expiration.
    await lockAttemptCreation(client, quizId, participantId);
    if (!await deleteManagedQuizAttempt(client, quizId, attemptId, ownerId)) {
      throw attemptError(404, 'ATTEMPT_NOT_FOUND', 'Quiz attempt not found');
    }
    await client.query('COMMIT');
    return { deleted: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (['40P01', '40001'].includes(error.code)) {
      throw attemptError(409, 'ATTEMPT_CONFLICT', 'The attempt changed concurrently; retry the request');
    }
    throw error;
  } finally { client.release(); }
}
