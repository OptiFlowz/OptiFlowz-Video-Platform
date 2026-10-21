import { fetchApiResponse, fetchFn } from '~/API';
import { env } from '~/env';
import { getToken } from '~/functions';
import type { QuestionType } from './model';

export type ImportResult = { imported_count: number; warnings: { question: number; code: string; message: string }[] };
export const questionXmlLimit = 5 * 1024 * 1024;
export function validQuestionFile(file: File) { return /\.xml$/i.test(file.name) && file.size > 0 && file.size <= questionXmlLimit; }
export async function importQuestions(file: File, categoryId: string): Promise<ImportResult> {
  const body = new FormData(); body.append('file', file);
  const query = categoryId ? `?${new URLSearchParams({ category_id: categoryId })}` : '';
  return fetchFn<ImportResult>({ route: `api/quizzes/questions/import${query}`, options: {
    method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body,
  } });
}
export async function exportQuestions(filters: { questionIds?: string[]; categoryId?: string; type?: QuestionType | '' }): Promise<Blob> {
  const query = new URLSearchParams();
  if (filters.questionIds?.length) query.set('question_ids', filters.questionIds.join(','));
  if (filters.categoryId) query.set('category_id', filters.categoryId);
  if (filters.type) query.set('type', filters.type);
  const response = await fetchApiResponse(`${env.apiBaseUrl}/api/quizzes/questions/export?${query}`, {
    method: 'GET', cache: 'no-store', headers: { Authorization: `Bearer ${getToken()}`, Accept: 'application/xml' },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || `HTTP ${response.status}`);
  }
  return response.blob();
}
export function downloadQuestions(blob: Blob) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'questions-moodle.xml';
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
