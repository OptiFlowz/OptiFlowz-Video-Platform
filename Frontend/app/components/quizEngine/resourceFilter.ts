import { filterQuestionPage } from './questionFilter';

export type OwnershipFilter = 'mine' | 'others' | 'all';
export function matchesOwnership(ownerId: string, userId: string | undefined, scope: OwnershipFilter) {
  if (!userId) return false;
  return scope === 'all' || (scope === 'mine' ? ownerId === userId : ownerId !== userId);
}

// Apply ownership and question search to the complete result, before pagination.
export function filterResourcePage<T extends { user_id: string; content?: string }>(rows: T[], userId: string | undefined, scope: OwnershipFilter, search: string, page: number, limit: number) {
  return filterQuestionPage(rows.filter(row => matchesOwnership(row.user_id, userId, scope)), search, page, limit);
}
