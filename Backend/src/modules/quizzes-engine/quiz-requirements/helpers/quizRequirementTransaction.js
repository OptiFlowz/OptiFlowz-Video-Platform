import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';

export async function withQuizRequirementTransaction(operation) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505' && error.constraint === 'quiz_requirements_pkey') {
      throw new HttpError(409, { message: 'This video is already a requirement for the quiz' });
    }
    if (error.code === '23514' && error.constraint === 'quiz_requirements_watch_seconds_duration_check') {
      throw new HttpError(400, { message: 'min_watch_seconds requires a known video duration and cannot exceed it' });
    }
    throw error;
  } finally { client.release(); }
}
