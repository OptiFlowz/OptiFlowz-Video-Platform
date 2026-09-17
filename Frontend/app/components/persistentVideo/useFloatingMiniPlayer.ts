"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Position = { x: number; y: number };
type Velocity = { x: number; y: number };
type HorizontalSnap = "left" | "right";
type VerticalSnap = "top" | "bottom";
type SnapPoint = { horizontal: HorizontalSnap; vertical: VerticalSnap };

type FloatingLayout = {
  width: number;
  height: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  isMobile: boolean;
  chatRect: DOMRect | null;
  gap: number;
};

type DragState = {
  pointerId: number;
  originPointer: Position;
  lastPointer: Position;
  lastTimestamp: number;
  originPosition: Position;
  velocity: Velocity;
  moved: boolean;
};

export const MINI_RESIZE_CORNERS = ["nw", "ne", "sw", "se"] as const;
type ResizeCorner = typeof MINI_RESIZE_CORNERS[number];
const DESKTOP_RESIZE_QUERY = "(min-width: 801px) and (hover: hover) and (pointer: fine)";
type ResizeState = {
  pointerId: number; corner: ResizeCorner; pointer: Position; position: Position;
  width: number; height: number; extraHeight: number; maxWidth: number;
};

const DEFAULT_SNAP: SnapPoint = { horizontal: "right", vertical: "bottom" };
const HORIZONTAL_SNAPS: HorizontalSnap[] = ["left", "right"];
const VERTICAL_SNAPS: VerticalSnap[] = ["top", "bottom"];

function numberFromStyle(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function getVisibleChatRect() {
  const chatButton = document.getElementById("optiflowz-chat-open");
  if (!(chatButton instanceof HTMLElement)) return null;

  const style = window.getComputedStyle(chatButton);
  const rect = chatButton.getBoundingClientRect();
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0 ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }

  return rect;
}

function getVisibleHeaderBottom() {
  const header = document.querySelector<HTMLElement>("[data-app-header]");
  if (!header) return 0;

  const style = window.getComputedStyle(header);
  const rect = header.getBoundingClientRect();
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.bottom <= 0
  ) {
    return 0;
  }

  return rect.bottom;
}

export function useFloatingMiniPlayer(active: boolean) {
  const miniPlayerRef = useRef<HTMLElement | null>(null);
  const safeAreaRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<Position | null>(null);
  const snapPointRef = useRef<SnapPoint>(DEFAULT_SNAP);
  const resizeRef = useRef<ResizeState | null>(null);
  const freePositionRef = useRef(false);
  const [resizeWidth, setResizeWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const lastDragEndRef = useRef(Number.NEGATIVE_INFINITY);
  const animationFrameRef = useRef(0);
  const [position, setPosition] = useState<Position | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPositionReady, setIsPositionReady] = useState(false);

  const updatePosition = useCallback((next: Position) => {
    positionRef.current = next;
    setPosition((current) => {
      if (
        current &&
        Math.abs(current.x - next.x) < 0.1 &&
        Math.abs(current.y - next.y) < 0.1
      ) {
        return current;
      }

      return next;
    });
  }, []);

  const getLayout = useCallback((): FloatingLayout | null => {
    const player = miniPlayerRef.current;
    if (!player) return null;

    // Transforms from the full ↔ mini FLIP animation affect the bounding rect.
    // Layout dimensions stay stable and must drive corner calculations, or the
    // scaled player briefly appears too large and snaps via the screen center.
    const playerWidth = player.offsetWidth;
    const playerHeight = player.offsetHeight;
    if (playerWidth <= 0 || playerHeight <= 0) return null;

    const safeStyle = safeAreaRef.current
      ? window.getComputedStyle(safeAreaRef.current)
      : null;
    const safeTop = safeStyle ? numberFromStyle(safeStyle.paddingTop) : 0;
    const safeRight = safeStyle ? numberFromStyle(safeStyle.paddingRight) : 0;
    const safeBottom = safeStyle ? numberFromStyle(safeStyle.paddingBottom) : 0;
    const safeLeft = safeStyle ? numberFromStyle(safeStyle.paddingLeft) : 0;
    const isMobile = window.matchMedia("(max-width: 500px)").matches;
    const gap = isMobile ? 10 : 24;
    const chatRect = getVisibleChatRect();
    const minX = safeLeft + gap;
    const headerBottom = getVisibleHeaderBottom();
    const minY = Math.max(safeTop + gap, headerBottom + gap);
    const maxX = window.innerWidth - safeRight - gap - playerWidth;
    let maxY = window.innerHeight - safeBottom - gap - playerHeight;

    // On phones the player always stays above the floating chat affordance.
    if (isMobile && chatRect) {
      maxY = Math.min(maxY, chatRect.top - playerHeight - 12);
    }

    return {
      width: playerWidth,
      height: playerHeight,
      minX,
      maxX: Math.max(minX, maxX),
      minY,
      maxY: Math.max(minY, maxY),
      isMobile,
      chatRect,
      gap,
    };
  }, []);

  const resolveSnapPoint = useCallback(
    (snapPoint: SnapPoint, layout = getLayout()): Position | null => {
      if (!layout) return null;

      // Explicit comparisons also make Fast Refresh recover safely if it kept
      // an older in-memory "center" snap from the previous implementation.
      const x = snapPoint.horizontal === "left" ? layout.minX : layout.maxX;
      let y = snapPoint.vertical === "top" ? layout.minY : layout.maxY;

      // Keep a desktop bottom snap from covering the chat button when their
      // horizontal areas overlap. Mobile already uses a raised maxY above.
      if (!layout.isMobile && snapPoint.vertical === "bottom" && layout.chatRect) {
        const playerRight = x + layout.width;
        const overlapsChatHorizontally =
          playerRight > layout.chatRect.left - layout.gap &&
          x < layout.chatRect.right + layout.gap;

        if (overlapsChatHorizontally) {
          y = Math.min(y, layout.chatRect.top - layout.height - 12);
        }
      }

      return {
        x: clamp(x, layout.minX, layout.maxX),
        y: clamp(y, layout.minY, layout.maxY),
      };
    },
    [getLayout],
  );

  const stopAnimation = useCallback(() => {
    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
  }, []);

  const springTo = useCallback(
    (target: Position, initialVelocity: Velocity) => {
      stopAnimation();

      let current = positionRef.current ?? target;
      let velocity = initialVelocity;
      let previousTimestamp = performance.now();
      const stiffness = 250;
      const damping = 29;

      const tick = (timestamp: number) => {
        const deltaSeconds = Math.min((timestamp - previousTimestamp) / 1000, 0.032);
        previousTimestamp = timestamp;

        const accelerationX = stiffness * (target.x - current.x) - damping * velocity.x;
        const accelerationY = stiffness * (target.y - current.y) - damping * velocity.y;
        velocity = {
          x: velocity.x + accelerationX * deltaSeconds,
          y: velocity.y + accelerationY * deltaSeconds,
        };
        current = {
          x: current.x + velocity.x * deltaSeconds,
          y: current.y + velocity.y * deltaSeconds,
        };
        updatePosition(current);

        const distance = Math.hypot(target.x - current.x, target.y - current.y);
        const speed = Math.hypot(velocity.x, velocity.y);
        if (distance < 0.5 && speed < 7) {
          updatePosition(target);
          animationFrameRef.current = 0;
          return;
        }

        animationFrameRef.current = requestAnimationFrame(tick);
      };

      animationFrameRef.current = requestAnimationFrame(tick);
    },
    [stopAnimation, updatePosition],
  );

  const snapFromVelocity = useCallback(
    (velocity: Velocity) => {
      const layout = getLayout();
      const current = positionRef.current;
      if (!layout || !current) return;

      // Project the release trajectory before selecting one of the four
      // corners. A fast flick can therefore land on the opposite corner.
      const projected = {
        x: current.x + velocity.x * 0.22,
        y: current.y + velocity.y * 0.22,
      };
      let bestSnap = snapPointRef.current;
      let bestTarget = resolveSnapPoint(bestSnap, layout) ?? current;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const horizontal of HORIZONTAL_SNAPS) {
        for (const vertical of VERTICAL_SNAPS) {
          const candidateSnap = { horizontal, vertical } satisfies SnapPoint;
          const candidate = resolveSnapPoint(candidateSnap, layout);
          if (!candidate) continue;

          const distance = Math.hypot(candidate.x - projected.x, candidate.y - projected.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestSnap = candidateSnap;
            bestTarget = candidate;
          }
        }
      }

      snapPointRef.current = bestSnap;
      springTo(bestTarget, velocity);
    },
    [getLayout, resolveSnapPoint, springTo],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!active || event.button !== 0 || resizeRef.current) return;
      const layout = getLayout();
      const current = positionRef.current ?? resolveSnapPoint(snapPointRef.current, layout);
      if (!layout || !current) return;

      stopAnimation();
      dragRef.current = {
        pointerId: event.pointerId,
        originPointer: { x: event.clientX, y: event.clientY },
        lastPointer: { x: event.clientX, y: event.clientY },
        lastTimestamp: performance.now(),
        originPosition: current,
        velocity: { x: 0, y: 0 },
        moved: false,
      };
    },
    [active, getLayout, resolveSnapPoint, stopAnimation],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const totalX = event.clientX - drag.originPointer.x;
      const totalY = event.clientY - drag.originPointer.y;
      if (!drag.moved && Math.hypot(totalX, totalY) < 4) return;

      if (!drag.moved) {
        freePositionRef.current = false;
        drag.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsDragging(true);
      }

      const layout = getLayout();
      if (!layout) return;

      const timestamp = performance.now();
      const elapsedMs = Math.max(timestamp - drag.lastTimestamp, 1);
      const instantVelocity = {
        x: ((event.clientX - drag.lastPointer.x) / elapsedMs) * 1000,
        y: ((event.clientY - drag.lastPointer.y) / elapsedMs) * 1000,
      };
      drag.velocity = {
        x: drag.velocity.x * 0.65 + instantVelocity.x * 0.35,
        y: drag.velocity.y * 0.65 + instantVelocity.y * 0.35,
      };
      drag.lastPointer = { x: event.clientX, y: event.clientY };
      drag.lastTimestamp = timestamp;

      updatePosition({
        x: clamp(drag.originPosition.x + totalX, layout.minX, layout.maxX),
        y: clamp(drag.originPosition.y + totalY, layout.minY, layout.maxY),
      });
    },
    [getLayout, updatePosition],
  );

  const finishPointerInteraction = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
      resizeRef.current = null;
      setIsResizing(false);
      setIsDragging(false);

      if (drag.moved) {
        lastDragEndRef.current = performance.now();
        const idleTime = Math.max(performance.now() - drag.lastTimestamp, 0);
        const releaseDecay = Math.exp(-idleTime / 120);
        snapFromVelocity({
          x: drag.velocity.x * releaseDecay,
          y: drag.velocity.y * releaseDecay,
        });
      }
    },
    [snapFromVelocity],
  );

  const startResize = useCallback((event: ReactPointerEvent<HTMLElement>, corner: ResizeCorner) => {
    event.stopPropagation();
    if (!active || event.button !== 0 || event.pointerType === "touch" || !window.matchMedia(DESKTOP_RESIZE_QUERY).matches) return;
    const layout = getLayout();
    const current = positionRef.current;
    if (!layout || !current) return;
    if (miniPlayerRef.current?.getAnimations().some(animation => animation.playState === "running")) return;
    event.preventDefault();
    stopAnimation();
    dragRef.current = null;
    const west = corner.includes("w");
    const north = corner.includes("n");
    const extraHeight = layout.height - layout.width * 9 / 16;
    const availableWidth = west ? current.x + layout.width - layout.minX : layout.maxX + layout.width - current.x;
    const availableHeight = north ? current.y + layout.height - layout.minY : layout.maxY + layout.height - current.y;
    resizeRef.current = {
      pointerId: event.pointerId, corner, pointer: { x: event.clientX, y: event.clientY },
      position: current, width: layout.width, height: layout.height, extraHeight,
      maxWidth: Math.max(1, Math.min(640, availableWidth, (availableHeight - extraHeight) * 16 / 9)),
    };
    freePositionRef.current = true;
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [active, getLayout, stopAnimation]);

  const moveResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const west = resize.corner.includes("w");
    const north = resize.corner.includes("n");
    const dx = (event.clientX - resize.pointer.x) * (west ? -1 : 1);
    const dy = (event.clientY - resize.pointer.y) * (north ? -1 : 1);
    const ratio = 9 / 16;
    // Project onto the aspect-ratio diagonal instead of switching between
    // horizontal and vertical deltas, which jumps when the dominant axis changes.
    const delta = (dx + dy * ratio) / (1 + ratio * ratio);
    const width = clamp(resize.width + delta, Math.min(280, resize.maxWidth), resize.maxWidth);
    const height = width * ratio + resize.extraHeight;
    const nextPosition = {
      x: west ? resize.position.x + resize.width - width : resize.position.x,
      y: north ? resize.position.y + resize.height - height : resize.position.y,
    };
    // Rebase at every step so reversing at a size limit responds immediately,
    // without first having to undo pointer movement beyond the limit.
    resize.pointer = { x: event.clientX, y: event.clientY };
    resize.width = width;
    resize.height = height;
    resize.position = nextPosition;
    setResizeWidth(width);
    updatePosition(nextPosition);
  }, [updatePosition]);

  const finishResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    resizeRef.current = null;
    freePositionRef.current = false;
    setIsResizing(false);
    lastDragEndRef.current = performance.now();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);

    // Wait for the final width to render before measuring the snap target.
    // Reserve the animation frame so the layout observer cannot snap instantly
    // before the spring starts. Keep the same corner chosen before resizing.
    stopAnimation();
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = 0;
      const target = resolveSnapPoint(snapPointRef.current);
      if (!target) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        updatePosition(target);
      } else {
        springTo(target, { x: 0, y: 0 });
      }
    });
  }, [resolveSnapPoint, springTo, stopAnimation, updatePosition]);

  const handleClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (performance.now() - lastDragEndRef.current >= 300) return;

    event.preventDefault();
    event.stopPropagation();
    lastDragEndRef.current = Number.NEGATIVE_INFINITY;
  }, []);

  useLayoutEffect(() => {
    if (!active) {
      dragRef.current = null;
      resizeRef.current = null;
      setIsResizing(false);
      setIsDragging(false);
      setIsPositionReady(false);
      stopAnimation();
      return;
    }

    let scheduledFrame = 0;
    const reposition = () => {
      if (resizeRef.current || dragRef.current?.moved || animationFrameRef.current) return;
      const player = miniPlayerRef.current;
      if (player?.getAnimations().some((animation) => animation.playState === "running")) {
        return;
      }
      const layout = getLayout();
      if (layout && window.matchMedia(DESKTOP_RESIZE_QUERY).matches) {
        const extraHeight = layout.height - layout.width * 9 / 16;
        const maxWidth = Math.min(640, layout.maxX + layout.width - layout.minX,
          (window.innerHeight - layout.gap - layout.minY - extraHeight) * 16 / 9);
        setResizeWidth(current => current === null ? null : Math.min(current, Math.max(1, maxWidth)));
      }
      const target = freePositionRef.current && layout && positionRef.current
        ? { x: clamp(positionRef.current.x, layout.minX, layout.maxX), y: clamp(positionRef.current.y, layout.minY, layout.maxY) }
        : resolveSnapPoint(snapPointRef.current, layout);
      if (target) {
        updatePosition(target);
        setIsPositionReady(true);
      }
    };
    const scheduleReposition = () => {
      cancelAnimationFrame(scheduledFrame);
      scheduledFrame = requestAnimationFrame(reposition);
    };

    const handleViewportResize = () => {
      // Manual resizing preserves the opposite corner only within the current
      // viewport. After a viewport change, anchor to the last snapped corner
      // using the new player dimensions (including the mobile layout).
      freePositionRef.current = false;
      stopAnimation();
      scheduleReposition();
    };

    const initialTarget = resolveSnapPoint(snapPointRef.current);
    if (initialTarget) {
      updatePosition(initialTarget);
      setIsPositionReady(true);
    } else {
      scheduleReposition();
    }
    const resizeObserver = new ResizeObserver(scheduleReposition);
    if (miniPlayerRef.current) resizeObserver.observe(miniPlayerRef.current);
    if (safeAreaRef.current) resizeObserver.observe(safeAreaRef.current);
    const appHeader = document.querySelector<HTMLElement>("[data-app-header]");
    if (appHeader) resizeObserver.observe(appHeader);
    window.addEventListener("resize", handleViewportResize);

    // The chat widget is injected asynchronously, so periodically re-check its
    // actual visible geometry while the floating player is open.
    const chatCheckInterval = window.setInterval(scheduleReposition, 750);

    return () => {
      cancelAnimationFrame(scheduledFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleViewportResize);
      window.clearInterval(chatCheckInterval);
      stopAnimation();
    };
  }, [active, getLayout, resolveSnapPoint, stopAnimation, updatePosition]);

  return {
    miniPlayerRef,
    safeAreaRef,
    position,
    isPositionReady,
    isDragging,
    isResizing,
    resizeWidth,
    resizeHandleProps: (corner: ResizeCorner) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => startResize(event, corner),
      onPointerMove: moveResize,
      onPointerUp: finishResize,
      onPointerCancel: finishResize,
      onLostPointerCapture: finishResize,
      onClick: (event: ReactMouseEvent<HTMLElement>) => { event.preventDefault(); event.stopPropagation(); },
    }),
    dragSurfaceProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishPointerInteraction,
      onPointerCancel: finishPointerInteraction,
      onClickCapture: handleClickCapture,
    },
  };
}
