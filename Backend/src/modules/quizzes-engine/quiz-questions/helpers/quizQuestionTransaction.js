import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';
import { getOwnedQuiz, lockOwnedQuestion } from '../repository/quiz-questions.repository.js';

export async function withQuizQuestionTransaction(quizId, questionId, userId, operation) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // The database ownership trigger uses the same quiz-before-question lock order.
    if (!await getOwnedQuiz(client, quizId, userId, true)) throw new HttpError(404, { message: 'Quiz not found' });
    if (!await lockOwnedQuestion(client, questionId, userId)) throw new HttpError(404, { message: 'Question not found' });
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505' && error.constraint === 'quiz_questions_pkey') {
      throw new HttpError(409, { message: 'This question is already linked to the quiz' });
    }
    if (error.code === '23514' && error.constraint === 'quiz_questions_same_user_check') {
      throw new HttpError(400, { message: 'The question and quiz must belong to the same user' });
    }
    throw error;
  } finally { client.release(); }
}
