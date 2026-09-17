/** Allow downward dismissal without stealing native scrolling in long submenus. */
export function setupSettingsSheetDrag(sheet: HTMLDialogElement, close: () => void) {
  let suppressClick = false;
  let drag: {
    id: number; x: number; y: number; lastY: number; time: number; velocity: number;
    offset: number; active: boolean; horizontal: boolean; header: boolean; scrollable: HTMLElement[];
  } | undefined;
  const start = (id: number, x: number, y: number, time: number, event: Event) => {
    suppressClick = false;
    if (!sheet.open || sheet.hasAttribute("data-closing")) return;
    const path = event.composedPath();
    const elements = path.slice(0, path.indexOf(sheet) + 1).filter((el): el is HTMLElement => el instanceof HTMLElement);
    if (elements.some(el => el.matches("input, textarea, select, [contenteditable='true']"))) return;
    drag = { id, x, y, lastY: y, time, velocity: 0, offset: 0, active: false, horizontal: false,
      header: elements.some(el => el.classList.contains("sheet-header")),
      scrollable: elements.filter(el => /auto|scroll/.test(window.getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) };
  };
  const move = (x: number, y: number, time: number) => {
    if (!drag) return false;
    const delta = y - drag.y;
    const step = y - drag.lastY;
    if (time > drag.time) drag.velocity = step / (time - drag.time);
    drag.lastY = y;
    drag.time = time;
    if (!drag.active && Math.abs(x - drag.x) > 6 && Math.abs(x - drag.x) > Math.abs(delta)) drag.horizontal = true;
    if (drag.horizontal) return false;
    const atTop = drag.scrollable.every(el => el.scrollTop <= 0);
    if (!drag.active && !drag.header && (!atTop || delta < 0)) { drag.y = y; return false; }
    if (!drag.active && Math.abs(delta) > 6 && (drag.header || delta > 0)) {
      drag.active = true;
      suppressClick = true;
      sheet.removeAttribute("data-opening");
      sheet.setAttribute("data-dragging", "");
    }
    if (drag.active) {
      drag.offset = Math.max(0, delta);
      sheet.style.setProperty("--sheet-drag-y", `${drag.offset}px`);
      return true;
    }
    return drag.header || (atTop && step > 0);
  };
  const finish = (time: number, cancelled = false) => {
    const current = drag;
    drag = undefined;
    sheet.removeAttribute("data-dragging");
    if (!current) return;
    const threshold = Math.min(140, sheet.getBoundingClientRect().height * .25);
    const fling = current.offset > 20 && current.velocity > .65 && time - current.time < 120;
    if (!cancelled && current.active && (current.offset > threshold || fling)) close();
    else sheet.style.removeProperty("--sheet-drag-y");
  };
  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" && event.isPrimary && event.button === 0) start(event.pointerId, event.clientX, event.clientY, event.timeStamp, event);
  };
  const pointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch" || drag?.id !== event.pointerId) return;
    if (move(event.clientX, event.clientY, event.timeStamp)) event.preventDefault();
    if (drag?.active && !sheet.hasPointerCapture(event.pointerId)) sheet.setPointerCapture(event.pointerId);
  };
  const pointerEnd = (event: PointerEvent) => {
    if (event.pointerType === "touch" || drag?.id !== event.pointerId) return;
    finish(event.timeStamp, event.type !== "pointerup");
    if (sheet.hasPointerCapture(event.pointerId)) sheet.releasePointerCapture(event.pointerId);
  };
  const touchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) { finish(event.timeStamp, true); return; }
    const touch = event.touches[0];
    start(touch.identifier, touch.clientX, touch.clientY, event.timeStamp, event);
  };
  const touchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) { finish(event.timeStamp, true); return; }
    const touch = Array.from(event.touches).find(touch => touch.identifier === drag?.id);
    if (touch && move(touch.clientX, touch.clientY, event.timeStamp) && event.cancelable) event.preventDefault();
  };
  const touchEnd = (event: TouchEvent) => {
    if (Array.from(event.changedTouches).some(touch => touch.identifier === drag?.id)) finish(event.timeStamp, event.type === "touchcancel");
  };
  const cancelClick = (event: MouseEvent) => {
    if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  };
  const cancelNativeDrag = (event: Event) => event.preventDefault();
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
    drag = undefined;
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
}
