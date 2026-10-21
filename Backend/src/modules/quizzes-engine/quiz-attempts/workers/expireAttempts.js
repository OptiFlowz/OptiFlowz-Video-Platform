import { writePool } from '../../../../database/index.js';
import { claimExpiredAttempts } from '../repository/attempt-expiration.repository.js';
import { finalizeExpiredAttempt } from '../services/finalizeAttempt.js';

export async function expireAttempts({ batchSize = 250, cursor = null, signal, logger = console, pool = writePool } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('Invalid expiration batch size');
  signal?.throwIfAborted();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    const attempts = await claimExpiredAttempts(client, batchSize, cursor);
    let finalized = 0, failed = 0;
    for (const attempt of attempts) {
      signal?.throwIfAborted();
      await client.query('SAVEPOINT expire_attempt');
      try {
        if (await finalizeExpiredAttempt(client, attempt.id)) finalized++;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT expire_attempt');
        if (error.status !== 422) throw error;
        // Invalid historical data must not prevent healthy attempts from closing.
        failed++;
        logger.error(`[quiz-expiration] attempt=${attempt.id} code=${error.body?.code}: ${error.message}`);
      }
      await client.query('RELEASE SAVEPOINT expire_attempt');
    }
    signal?.throwIfAborted();
    await client.query('COMMIT');
    const last = attempts.at(-1);
    // Rotate through the expired set so a full batch of invalid attempts cannot
    // starve later rows. Keep PostgreSQL timestamp precision in this cursor.
    const nextCursor = attempts.length === batchSize ? { expiresAt: last.cursor_expires_at, id: last.id } : null;
    return { scanned: attempts.length, finalized, failed, nextCursor };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
