import type { Listing } from './model';

export function filterQuestionPage<T extends { content?: string }>(questions: T[], search: string, page: number, limit: number): Listing<T> {
  const needle = search.trim().toLocaleLowerCase();
  const matches = questions.filter(question => (question.content ?? '').toLocaleLowerCase().includes(needle));
  const total = matches.length;
  const totalPages = Math.ceil(total / limit);
  return {
    items: matches.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
  };
}
