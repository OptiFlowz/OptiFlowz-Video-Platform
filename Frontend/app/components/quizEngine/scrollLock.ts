let activeLock: { count: number; restore: () => void } | null = null;

/** Nested editors share a lock so closing one cannot unlock the page behind it. */
export function lockEditorPageScroll() {
  if (!activeLock) {
    const body = document.body, root = document.documentElement;
    const x = window.scrollX, y = window.scrollY;
    const properties = ['position', 'top', 'left', 'width', 'overflow'] as const;
    const previous = properties.map(name => [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)]);
    const previousRoot = ['overflow', 'scrollbar-gutter'].map(name => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]);
    // Keep the viewport width unchanged, including for fixed headers, when its scrollbar disappears.
    if (window.innerWidth > root.clientWidth && !window.getComputedStyle(root).scrollbarGutter.includes('stable')) {
      root.style.setProperty('scrollbar-gutter', 'stable');
    }
    Object.assign(body.style, { position: 'fixed', top: `${-y}px`, left: `${-x}px`, width: '100%', overflow: 'hidden' });
    root.style.overflow = 'hidden';
    activeLock = { count: 0, restore: () => {
      for (const [name, value, priority] of previous) {
        if (value) body.style.setProperty(name, value, priority);
        else body.style.removeProperty(name);
      }
      for (const [name, value, priority] of previousRoot) {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      }
      const behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      window.scrollTo(x, y);
      root.style.scrollBehavior = behavior;
    } };
  }
  const lock = activeLock;
  lock.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count === 0) { lock.restore(); activeLock = null; }
  };
}
