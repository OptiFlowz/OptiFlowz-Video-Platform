// Keep programmatic navigation inside the drawer instead of scrolling its page.
export function scrollWithinPlayerSheet(target: HTMLElement, block: "start" | "nearest" = "nearest") {
  const sheet = target.closest<HTMLElement>(".playerSheet");
  if (!sheet || !window.matchMedia("(max-width: 500px)").matches) return false;
  for (let parent = target.parentElement; parent && parent !== sheet; parent = parent.parentElement) {
    if (!/auto|scroll/.test(getComputedStyle(parent).overflowY)) continue;
    const bounds = parent.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const top = Math.max(bounds.top, sheet.getBoundingClientRect().top);
    const bottom = Math.min(bounds.bottom, sheet.getBoundingClientRect().bottom);
    const delta = block === "start" || rect.top < top + 12 ? rect.top - top - 12
      : rect.bottom > bottom - 12 ? Math.min(rect.top - top - 12, rect.bottom - bottom + 12) : 0;
    if (delta) parent.scrollTo({ top: parent.scrollTop + delta, behavior: "instant" });
  }
  return true;
}
