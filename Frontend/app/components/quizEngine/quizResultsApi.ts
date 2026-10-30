import { all, request } from './api';
import type { ManagedAttempt } from './quizResultsModel';

export async function deleteQuizAttempt(quizId: string, attemptId: string) {
  const result = await request<{ deleted: boolean }>(`/${encodeURIComponent(quizId)}/attempts/${encodeURIComponent(attemptId)}`, 'DELETE');
  if (!result.deleted) throw new Error('Attempt was not deleted');
}

// Collect every page before deleting: deleting while paging would skip shifted rows.
export async function resetQuizAttempts(quizId: string, onProgress: (deleted: number, total: number) => void) {
  const path = `/${encodeURIComponent(quizId)}`;
  const attempts = await all<ManagedAttempt>(`${path}/results`, 'attempts');
  onProgress(0, attempts.length);
  for (const [index, attempt] of attempts.entries()) {
    await deleteQuizAttempt(quizId, attempt.id);
    onProgress(index + 1, attempts.length);
  }
}
