import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const duration = 420;
const easing = "cubic-bezier(0.22, 1, 0.36, 1)";
type Snapshot = { element: HTMLElement; rect: DOMRect };

export function useTheaterTransition(isTheater: boolean) {
  const pageRef = useRef<HTMLElement>(null);
  const snapshotsRef = useRef<Snapshot[] | null>(null);
  const animationsRef = useRef<Animation[]>([]);
  const timerRef = useRef<number | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionId, setTransitionId] = useState(0);

  const clearAnimation = useCallback(() => {
    animationsRef.current.forEach(animation => animation.cancel());
    animationsRef.current = [];
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const prepareTransition = useCallback(() => {
    const page = pageRef.current;
    if (!page || window.matchMedia("(max-width: 1075px)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Measure the current visual positions, including any animation being reversed.
    snapshotsRef.current = Array.from(page.querySelectorAll<HTMLElement>(":scope > .watchDetails, :scope > .relevant"))
      .map(element => ({ element, rect: element.getBoundingClientRect() }));
    setIsTransitioning(true);
    setTransitionId(id => id + 1);
  }, []);

  useLayoutEffect(() => {
    const snapshots = snapshotsRef.current;
    snapshotsRef.current = null;
    clearAnimation();
    if (!snapshots) {
      setIsTransitioning(false);
      return;
    }

    // Apply the new layout first, then translate its existing elements from their old positions.
    for (const { element, rect: before } of snapshots) {
      if (!element.isConnected || typeof element.animate !== "function") continue;
      const after = element.getBoundingClientRect();
      if (!before.width || !after.width) continue;
      const animation = element.animate([
        { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)` },
        { transform: "translate(0, 0)" },
      ], { duration, easing, fill: "both" });
      animation.onfinish = () => animation.cancel();
      animationsRef.current.push(animation);
    }

    // Allow the persistent player's next-frame anchor measurement to finish its matching transition.
    timerRef.current = window.setTimeout(() => {
      clearAnimation();
      setIsTransitioning(false);
    }, duration + 80);
  }, [isTheater, transitionId, clearAnimation]);

  useEffect(() => {
    const cancelOnResize = () => {
      snapshotsRef.current = null;
      clearAnimation();
      setIsTransitioning(false);
    };
    window.addEventListener("resize", cancelOnResize);
    return () => {
      window.removeEventListener("resize", cancelOnResize);
      clearAnimation();
    };
  }, [clearAnimation]);

  return { pageRef, prepareTransition, isTransitioning };
}
