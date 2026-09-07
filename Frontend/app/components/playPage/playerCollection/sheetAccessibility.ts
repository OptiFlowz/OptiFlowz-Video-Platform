// Share one isolation boundary when panels briefly overlap during navigation.
const sheets = new Set<HTMLElement>();
const previous = new Map<HTMLElement, boolean>();
let observer: MutationObserver | null = null;
let frame = 0;

function restore() {
  previous.forEach((inert, node) => { node.inert = inert; });
  previous.clear();
}

function isolate() {
  restore();
  const active = Array.from(sheets).filter(sheet => sheet.isConnected).at(-1);
  if (!active) return;
  const allowed = [active, ...document.querySelectorAll<HTMLElement>(".persistent-video-player--full, [role='dialog']")];
  function visit(parent: HTMLElement) {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement) || ["SCRIPT", "STYLE", "LINK"].includes(child.tagName)) continue;
      if (allowed.includes(child)) continue;
      if (allowed.some(node => child.contains(node))) visit(child);
      else { previous.set(child, child.inert); child.inert = true; }
    }
  }
  visit(document.body);
  // Loading/error/list views may replace the focused scroll container.
  if (document.activeElement === document.body) {
    const content = active.querySelector<HTMLElement>(":scope > .similar");
    if (content) { content.tabIndex = -1; content.focus({ preventScroll: true }); }
  }
}

export function isolatePlayerSheet(sheet: HTMLElement) {
  sheets.add(sheet);
  isolate();
  if (!observer) {
    observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(isolate);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  return () => {
    sheets.delete(sheet);
    if (sheets.size) isolate();
    else {
      observer?.disconnect();
      observer = null;
      cancelAnimationFrame(frame);
      restore();
    }
  };
}

export function isActivePlayerSheet(sheet: HTMLElement) {
  return Array.from(sheets).at(-1) === sheet;
}
