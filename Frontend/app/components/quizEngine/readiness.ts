import type { Question, Source } from './model';
export function questionReady(q: Question): boolean {
  if (!q.content.trim()) return false;
  if (q.type === 'matching') {
    const options = q.matching_options ?? [], items = q.matching_items ?? [];
    return !!options.length && !!items.length && options.every(o => !!o.content.trim()) && items.every(i => !!i.content.trim() && options.some(o => o.option_no === i.correct_option_no));
  }
  const options = q.options ?? [], correct = options.filter(o => o.is_correct).length;
  return !!options.length && options.every(o => !!o.content.trim()) && (q.type === 'single_choice' ? correct === 1 : correct >= 1);
}
export function allocationValid(sources: Source[]): boolean {
  return sources.length <= 1000 && new Set(sources.map(s => s.category_id)).size === sources.length && sources.every(s =>
    (s.category_id === null || !!s.category_id) && Number.isInteger(s.question_count) && s.question_count > 0 && s.question_count <= 2147483647
    && (s.max_points === null || (Number.isFinite(s.max_points) && s.max_points > 0 && s.max_points <= 99999999.99
    && Math.abs(s.max_points * 100 - Math.round(s.max_points * 100)) < 1e-6))
    && Number.isInteger(s.position) && s.position >= 0 && s.position <= 2147483647);
}
export function questionCount(fixed: { question_id: string }[], sources: Source[]): number {
  return new Set(fixed.map(q => q.question_id)).size + sources.reduce((sum, s) => sum + s.question_count, 0);
}
export function nextPosition(...lists: { position: number }[][]): number {
  return Math.max(-1, ...lists.flat().map(row => row.position)) + 1;
}
// Sources draw from the owner's entire bank, excluding every fixed question.
// Null is the uncategorized pool, never a catch-all.
export function canFillSources(sources: Source[], fixed: Question[], bank: Question[]): boolean {
  const fixedIds = new Set(fixed.map(q => q.id));
  return sources.every(source => new Set(bank.filter(q => !fixedIds.has(q.id)
    && (q.category?.id ?? null) === source.category_id).map(q => q.id)).size >= source.question_count);
}
export function readiness(fixed: Question[], sources: Source[], bank: Question[] = []): string[] {
  const errors: string[] = [];
  if (!fixed.length && !sources.length) errors.push('qeTooFew');
  const pool = bank.filter(q => sources.some(s => s.category_id === (q.category?.id ?? null)));
  if ([...fixed, ...pool].some(q => !questionReady(q))) errors.push('qeIncomplete');
  if (!allocationValid(sources)) errors.push('qeAllocationInvalid');
  else if (!canFillSources(sources, fixed, bank)) errors.push('qeOverlap');
  return errors;
}
