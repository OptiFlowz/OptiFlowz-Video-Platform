import { fetchFn } from '~/API';
import { getToken } from '~/functions';

export const validQuizThumbnail = (file: File) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size > 0 && file.size <= 5 * 1024 * 1024;

export async function uploadQuizThumbnail(id: string, file: File | null) {
  const body = new FormData();
  if (file) body.append('file', file);
  const result = await fetchFn<{ success?: boolean; message?: string; quiz: { id: string; thumbnail_url: string | null } }>({
    route: `api/quizzes/${encodeURIComponent(id)}/thumbnail`,
    options: { method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${getToken()}` }, body },
  });
  if (result.success === false) throw new Error(result.message || 'Request failed');
  return result.quiz;
}
