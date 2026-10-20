import type { Question, QuizSettings, Source } from './model';
export function questionReady(q: Question): boolean {
  if (!q.content.trim()) return false;
  if (q.type === 'matching') {
    const options = q.matching_options ?? [], items = q.matching_items ?? [];
    return !!options.length && !!items.length && options.every(o => !!o.content.trim()) && items.every(i => !!i.content.trim() && options.some(o => o.option_no === i.correct_option_no));
  }
  const options = q.options ?? [], correct = options.filter(o => o.is_correct).length;
  return !!options.length && options.every(o => !!o.content.trim()) && (q.type === 'single_choice' ? correct === 1 : correct >= 1);
}
export function allocationValid(sources: Source[], count: number): boolean {
  if (!sources.length) return true;
  if (new Set(sources.map(s => s.group_id)).size !== sources.length || sources.some(s => !s.group_id)) return false;
  const percentages = sources[0].question_percentage !== null;
  if (percentages) return sources.every(s => s.question_count === null && s.question_percentage !== null && s.question_percentage > 0 && s.question_percentage <= 100 && Math.abs(s.question_percentage * 100 - Math.round(s.question_percentage * 100)) < 1e-6) && sources.reduce((sum, s) => sum + Math.round(s.question_percentage! * 100), 0) === 10000;
  return sources.every(s => s.question_percentage === null && Number.isInteger(s.question_count) && s.question_count! > 0) && sources.reduce((sum, s) => sum + s.question_count!, 0) === count;
}
export function sourceQuotas(sources: Source[], count: number): number[] {
  if (!sources.length) return [];
  if (sources[0].question_count !== null) return sources.map(s => s.question_count!);
  const raw = sources.map(s => Math.round(s.question_percentage! * 100) * count / 10000);
  const quotas = raw.map(Math.floor);
  const order = sources.map((_, i) => i).sort((a, b) => (raw[b] - quotas[b]) - (raw[a] - quotas[a]) || sources[a].position - sources[b].position || sources[a].group_id.localeCompare(sources[b].group_id));
  const remaining = count - quotas.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < remaining; i++) quotas[order[i]]++;
  return quotas;
}
// An augmenting-path assignment handles overlapping groups: one question can fill only one slot.
export function canFillSources(sources: Source[], count: number, questions: Question[]): boolean {
  const quotas = sourceQuotas(sources, count);
  const slots = sources.flatMap((s, i) => Array.from({ length: quotas[i] }, () => questions.filter(q => q.groups.some(g => g.id === s.group_id)).map(q => q.id)));
  const assigned = new Map<string, number>();
  function assign(slot: number, visited: Set<string>): boolean {
    for (const id of slots[slot]) {
      if (visited.has(id)) continue;
      visited.add(id);
      const previous = assigned.get(id);
      if (previous === undefined || assign(previous, visited)) { assigned.set(id, slot); return true; }
    }
    return false;
  }
  return slots.every((_, i) => assign(i, new Set()));
}
export function readiness(settings: QuizSettings, questions: Question[], sources: Source[]): string[] {
  const errors: string[] = [];
  if (questions.length < settings.question_count) errors.push('qeTooFew');
  if (questions.some(q => !questionReady(q))) errors.push('qeIncomplete');
  if (!allocationValid(sources, settings.question_count)) errors.push('qeAllocationInvalid');
  else if (questions.length >= settings.question_count && sources.length && !canFillSources(sources, settings.question_count, questions)) errors.push('qeOverlap');
  return errors;
}
