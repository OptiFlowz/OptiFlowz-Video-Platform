"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Position = { x: number; y: number };
type Velocity = { x: number; y: number };
type HorizontalSnap = "left" | "center" | "right";
type VerticalSnap = "top" | "center" | "bottom";
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

const DEFAULT_SNAP: SnapPoint = { horizontal: "right", vertical: "bottom" };
const HORIZONTAL_SNAPS: HorizontalSnap[] = ["left", "center", "right"];
const VERTICAL_SNAPS: VerticalSnap[] = ["top", "center", "bottom"];

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

export function useFloatingMiniPlayer(active: boolean) {
  const miniPlayerRef = useRef<HTMLElement | null>(null);
  const safeAreaRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<Position | null>(null);
  const snapPointRef = useRef<SnapPoint>(DEFAULT_SNAP);
  const dragRef = useRef<DragState | null>(null);
  const animationFrameRef = useRef(0);
  const [position, setPosition] = useState<Position | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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

    const playerRect = player.getBoundingClientRect();
    if (playerRect.width <= 0 || playerRect.height <= 0) return null;

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
    const minY = safeTop + gap;
    const maxX = window.innerWidth - safeRight - gap - playerRect.width;
    let maxY = window.innerHeight - safeBottom - gap - playerRect.height;

    // On phones the player always stays above the floating chat affordance.
    if (isMobile && chatRect) {
      maxY = Math.min(maxY, chatRect.top - playerRect.height - 12);
    }

    return {
      width: playerRect.width,
      height: playerRect.height,
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

      const horizontalPositions: Record<HorizontalSnap, number> = {
        left: layout.minX,
        center: (layout.minX + layout.maxX) / 2,
        right: layout.maxX,
      };
      const verticalPositions: Record<VerticalSnap, number> = {
        top: layout.minY,
        center: (layout.minY + layout.maxY) / 2,
        bottom: layout.maxY,
      };

      const x = horizontalPositions[snapPoint.horizontal];
      let y = verticalPositions[snapPoint.vertical];

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

      // Project the release trajectory before selecting a snap point. A fast
      // flick can therefore cross the centre and land on the opposite edge.
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
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!active || event.button !== 0) return;

      const layout = getLayout();
      const current = positionRef.current ?? resolveSnapPoint(snapPointRef.current, layout);
      if (!layout || !current) return;

      stopAnimation();
      event.currentTarget.setPointerCapture(event.pointerId);
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
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const totalX = event.clientX - drag.originPointer.x;
      const totalY = event.clientY - drag.originPointer.y;
      if (!drag.moved && Math.hypot(totalX, totalY) < 4) return;

      if (!drag.moved) {
        drag.moved = true;
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
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
      setIsDragging(false);

      if (drag.moved) {
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

  useLayoutEffect(() => {
    if (!active) {
      dragRef.current = null;
      setIsDragging(false);
      stopAnimation();
      return;
    }

    let scheduledFrame = 0;
    const reposition = () => {
      if (dragRef.current?.moved || animationFrameRef.current) return;
      const target = resolveSnapPoint(snapPointRef.current);
      if (target) updatePosition(target);
    };
    const scheduleReposition = () => {
      cancelAnimationFrame(scheduledFrame);
      scheduledFrame = requestAnimationFrame(reposition);
    };

    scheduleReposition();
    const resizeObserver = new ResizeObserver(scheduleReposition);
    if (miniPlayerRef.current) resizeObserver.observe(miniPlayerRef.current);
    if (safeAreaRef.current) resizeObserver.observe(safeAreaRef.current);
    window.addEventListener("resize", scheduleReposition);

    // The chat widget is injected asynchronously, so periodically re-check its
    // actual visible geometry while the floating player is open.
    const chatCheckInterval = window.setInterval(scheduleReposition, 750);

    return () => {
      cancelAnimationFrame(scheduledFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleReposition);
      window.clearInterval(chatCheckInterval);
      stopAnimation();
    };
  }, [active, resolveSnapPoint, stopAnimation, updatePosition]);

  return {
    miniPlayerRef,
    safeAreaRef,
    position,
    isDragging,
    dragSurfaceProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishPointerInteraction,
      onPointerCancel: finishPointerInteraction,
    },
  };
}
