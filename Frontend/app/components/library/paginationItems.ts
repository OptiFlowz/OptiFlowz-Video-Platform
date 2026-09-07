export function getPaginationItems(page: number, totalPages: number): Array<number | "…"> {
  const total = Math.max(1, Math.floor(totalPages));
  const current = Math.max(1, Math.min(page, total));
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "…", total];
  if (current >= total - 3) return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "…", current - 1, current, current + 1, "…", total];
}
