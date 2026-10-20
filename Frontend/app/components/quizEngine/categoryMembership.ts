/** Apply local membership changes to a refreshed category after editing a question. */
export function reconcileCategoryMembers(previous: string[], draft: string[], refreshed: string[]): string[] {
  const removed = new Set(previous.filter(id => !draft.includes(id)));
  const added = draft.filter(id => !previous.includes(id));
  return [...new Set([...refreshed.filter(id => !removed.has(id)), ...added])];
}
export function sameCategoryMembers(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every(id => b.includes(id));
}
