import { all, request } from './api';
import type { ManagedAttempt } from './quizResultsModel';

// Collect every page before deleting: deleting while paging would skip shifted rows.
export async function resetQuizAttempts(quizId: string, onProgress: (deleted: number, total: number) => void) {
  const path = `/${encodeURIComponent(quizId)}`;
  const attempts = await all<ManagedAttempt>(`${path}/results`, 'attempts');
  onProgress(0, attempts.length);
  for (const [index, attempt] of attempts.entries()) {
    const result = await request<{ deleted: boolean }>(`${path}/attempts/${encodeURIComponent(attempt.id)}`, 'DELETE');
    if (!result.deleted) throw new Error('Attempt was not deleted');
    onProgress(index + 1, attempts.length);
  }
}
