import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const mobileQuery = "(max-width: 500px)";
const animationDuration = 220;

// More than one panel can briefly exist while switching views. Keep the page
// locked until the last mobile sheet releases it, preserving the scroll position.
let scrollLock: { count: number; release: () => void } | null = null;
function lockPageScroll() {
  if (!scrollLock) {
    const body = document.body;
    const root = document.documentElement;
    const x = window.scrollX;
    const y = window.scrollY;
    const properties = ["position", "top", "left", "width", "overflow"] as const;
    const previous = properties.map(name => [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)]);
    const overflow = root.style.overflow;
    Object.assign(body.style, { position: "fixed", top: `${-y}px`, left: `${-x}px`, width: "100%", overflow: "hidden" });
    root.style.overflow = "hidden";
    scrollLock = { count: 0, release: () => {
      for (const [name, value, priority] of previous) {
        if (value) body.style.setProperty(name, value, priority);
        else body.style.removeProperty(name);
      }
      root.style.overflow = overflow;
      const behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(x, y);
      root.style.scrollBehavior = behavior;
    } };
  }
  scrollLock.count++;
  return () => {
    if (scrollLock && --scrollLock.count === 0) {
      scrollLock.release();
      scrollLock = null;
    }
  };
}

type Gesture = {
  id: number;
  startX: number;
  startY: number;
  lastY: number;
  lastTime: number;
  velocity: number;
  offset: number;
  active: boolean;
  horizontal: boolean;
  header: boolean;
  scrollContainers: HTMLElement[];
};

export default function PlayerSheet({ className = "", onClose, header, children }: {
  className?: string;
  onClose: () => void;
  header: (close: () => void) => ReactNode;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef(false);
  const drag = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [bounds, setBounds] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const media = window.matchMedia(mobileQuery);
    const anchor = document.querySelector<HTMLElement>("main.play .player");
    const player = document.querySelector<HTMLElement>(".persistent-video-player--full");
    const pageHeader = document.querySelector("header");
    const update = () => {
      if (!media.matches) {
        setBounds(null);
        drag.current = null;
        setDragging(false);
        setDragY(0);
        return;
      }
      const playerRect = player?.getBoundingClientRect();
      const rect = playerRect && playerRect.width > 0 && playerRect.height > 0
        ? playerRect : anchor?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const top = Math.max(0, Math.min(rect?.bottom ?? pageHeader?.getBoundingClientRect().bottom ?? 0, viewportBottom));
      const height = Math.max(0, viewportBottom - top);
      setBounds(previous => previous?.top === top && previous.height === height ? previous : { top, height });
    };
    update();
    const resizeObserver = new ResizeObserver(update);
    for (const element of [anchor, player, pageHeader]) if (element) resizeObserver.observe(element);
    const positionObserver = new MutationObserver(update);
    if (player) positionObserver.observe(player, { attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    media.addEventListener("change", update);
    return () => {
      resizeObserver.disconnect();
      positionObserver.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      media.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => {
      cancelAnimationFrame(frame);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    drag.current = null;
    setDragging(false);
    setOpen(false);
    if (!window.matchMedia(mobileQuery).matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onCloseRef.current();
    } else {
      closeTimer.current = setTimeout(() => onCloseRef.current(), animationDuration);
    }
  }, []);

  const mobile = bounds !== null;
  useLayoutEffect(() => {
    if (!mobile) return;
    return lockPageScroll();
  }, [mobile]);

  useEffect(() => {
    if (!mobile || !open) return;
    const sheet = sheetRef.current;
    const content = sheet?.querySelector<HTMLElement>(":scope > .similar");
    if (!sheet || !content) return;
    const previousFocus = document.activeElement;
    const previousTabIndex = content.getAttribute("tabindex");
    content.tabIndex = -1;
    content.focus({ preventScroll: true });
    return () => {
      if (previousTabIndex === null) content.removeAttribute("tabindex");
      else content.setAttribute("tabindex", previousTabIndex);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected &&
          (sheet.contains(document.activeElement) || document.activeElement === document.body)) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [mobile, open]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!mobile || !sheet) return;
    const start = (id: number, x: number, y: number, time: number, target: EventTarget | null) => {
      suppressClick.current = false;
      if (closing.current || !(target instanceof Element)) return;
      // Editors retain text selection and their own scrolling. Buttons and links
      // remain eligible: their click is only cancelled after an actual drag.
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      const header = !!target.closest(".playlistHeader");
      const content = target.closest(".similar");
      if (!header && !content) return;
      const scrollContainers: HTMLElement[] = [];
      for (let element = target; element && element !== sheet; element = element.parentElement!) {
        if (element instanceof HTMLElement &&
            /auto|scroll/.test(getComputedStyle(element).overflowY) &&
            element.scrollHeight > element.clientHeight) scrollContainers.push(element);
      }
      drag.current = { id, startX: x, startY: y, lastY: y, lastTime: time, velocity: 0,
        offset: 0, active: false, horizontal: false, header, scrollContainers };
    };
    const move = (x: number, y: number, time: number) => {
      const current = drag.current;
      if (!current) return false;
      const step = y - current.lastY;
      const elapsed = time - current.lastTime;
      if (elapsed > 0) current.velocity = step / elapsed;
      current.lastY = y;
      current.lastTime = time;
      const delta = y - current.startY;
      const horizontal = x - current.startX;
      if (!current.active && Math.abs(horizontal) > 6 && Math.abs(horizontal) > Math.abs(delta)) current.horizontal = true;
      if (current.horizontal) return false;
      // iOS rubber-banding can report negative scrollTop; that is still the top.
      const atTop = current.scrollContainers.every(element => element.scrollTop <= 0);
      if (!current.active && !current.header && (!atTop || delta < 0)) {
        current.startY = y;
        return false;
      }
      if (!current.active && Math.abs(delta) > 6 && (current.header || delta > 0)) {
        current.active = true;
        suppressClick.current = true;
        setDragging(true);
      }
      if (current.active) {
        current.offset = Math.max(0, delta);
        setDragY(current.offset);
        return true;
      }
      return current.header || (atTop && step > 0);
    };
    const finish = (time: number, cancelled = false) => {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      setDragging(false);
      const threshold = Math.min(140, sheet.getBoundingClientRect().height * 0.25);
      const fling = current.offset > 20 && current.velocity > 0.65 && time - current.lastTime < 120;
      if (!cancelled && current.active && (current.offset > threshold || fling)) close();
      else setDragY(0);
    };
    const pointerDown = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "touch" || !event.isPrimary || event.button !== 0) return;
      start(event.pointerId, event.clientX, event.clientY, event.timeStamp, event.target);
    };
    const pointerMove = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "touch" || drag.current?.id !== event.pointerId) return;
      if (move(event.clientX, event.clientY, event.timeStamp)) event.preventDefault();
      if (drag.current?.active && !sheet.hasPointerCapture(event.pointerId)) sheet.setPointerCapture(event.pointerId);
    };
    const pointerEnd = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "touch" || drag.current?.id !== event.pointerId) return;
      finish(event.timeStamp, event.type !== "pointerup");
      if (sheet.hasPointerCapture(event.pointerId)) sheet.releasePointerCapture(event.pointerId);
    };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { finish(event.timeStamp, true); return; }
      const touch = event.touches[0];
      start(touch.identifier, touch.clientX, touch.clientY, event.timeStamp, event.target);
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) { finish(event.timeStamp, true); return; }
      const touch = Array.from(event.touches).find(touch => touch.identifier === drag.current?.id);
      if (!touch) return;
      const draggingSheet = move(touch.clientX, touch.clientY, event.timeStamp);
      const current = drag.current;
      const atBottom = current && current.scrollContainers.every(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1);
      // A non-passive touch listener lets us take over a downward pan at the
      // scroll boundary on Safari without disabling normal native list scrolling.
      if (event.cancelable && (draggingSheet || (atBottom && current && current.velocity < 0))) event.preventDefault();
    };
    const touchEnd = (event: TouchEvent) => {
      if (Array.from(event.changedTouches).some(touch => touch.identifier === drag.current?.id)) finish(event.timeStamp, event.type === "touchcancel");
    };
    const cancelClick = (event: MouseEvent) => {
      if (suppressClick.current && event.detail !== 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick.current = false;
      }
    };
    const cancelNativeDrag = (event: DragEvent) => event.preventDefault();
    sheet.addEventListener("pointerdown", pointerDown);
    sheet.addEventListener("pointermove", pointerMove);
    sheet.addEventListener("pointerup", pointerEnd);
    sheet.addEventListener("pointercancel", pointerEnd);
    sheet.addEventListener("lostpointercapture", pointerEnd);
    sheet.addEventListener("touchstart", touchStart, { passive: true });
    sheet.addEventListener("touchmove", touchMove, { passive: false });
    sheet.addEventListener("touchend", touchEnd);
    sheet.addEventListener("touchcancel", touchEnd);
    sheet.addEventListener("click", cancelClick, true);
    sheet.addEventListener("dragstart", cancelNativeDrag);
    return () => {
      drag.current = null;
      sheet.removeEventListener("pointerdown", pointerDown);
      sheet.removeEventListener("pointermove", pointerMove);
      sheet.removeEventListener("pointerup", pointerEnd);
      sheet.removeEventListener("pointercancel", pointerEnd);
      sheet.removeEventListener("lostpointercapture", pointerEnd);
      sheet.removeEventListener("touchstart", touchStart);
      sheet.removeEventListener("touchmove", touchMove);
      sheet.removeEventListener("touchend", touchEnd);
      sheet.removeEventListener("touchcancel", touchEnd);
      sheet.removeEventListener("click", cancelClick, true);
      sheet.removeEventListener("dragstart", cancelNativeDrag);
    };
  }, [mobile, close]);

  const style: CSSProperties | undefined = bounds ? {
    top: bounds.top,
    height: bounds.height,
    ...(open ? { transform: `translate3d(0, ${dragY}px, 0)` } : {}),
  } : undefined;

  return (
    <div ref={sheetRef} className={`sidePlaylists playerSheet ${className} ${open ? "" : "closed"} ${dragging ? "is-dragging" : ""}`} style={style}>
      <div className="playlistHeader">
        <div className="playerSheetHandle" aria-hidden="true"><span /></div>
        {header(close)}
      </div>
      {children}
    </div>
  );
}
