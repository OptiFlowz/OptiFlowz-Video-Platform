"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export type PersistentPlayerMode = "hidden" | "full" | "mini";

type VisualRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius: string;
  boxShadow: string;
};

function readVisualRect(element: HTMLElement): VisualRect | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const style = window.getComputedStyle(element);
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    borderRadius: style.borderRadius,
    boxShadow: style.boxShadow,
  };
}

export function usePlayerMorphTransition(
  playerRef: RefObject<HTMLElement | null>,
  mode: PersistentPlayerMode,
  layoutKey: string,
  isTargetReady: boolean,
) {
  const previousModeRef = useRef<PersistentPlayerMode>("hidden");
  const currentModeRef = useRef<PersistentPlayerMode>(mode);
  const previousRectRef = useRef<VisualRect | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const [isMorphing, setIsMorphing] = useState(false);
  currentModeRef.current = mode;

  // Keep the source viewport rect fresh without updating React state. The full
  // player scrolls naturally with the document, while this ref is only read if
  // a later route change starts a morph animation.
  useEffect(() => {
    if (mode === "hidden") return;

    const capture = () => {
      if (currentModeRef.current !== "full" || animationRef.current) return;
      const player = playerRef.current;
      if (!player) return;
      previousRectRef.current = readVisualRect(player);
    };

    window.addEventListener("scroll", capture, { capture: true, passive: true });
    window.visualViewport?.addEventListener("scroll", capture, { passive: true });

    return () => {
      window.removeEventListener("scroll", capture, true);
      window.visualViewport?.removeEventListener("scroll", capture);
    };
  }, [mode, playerRef]);

  useLayoutEffect(() => {
    const player = playerRef.current;
    const previousMode = previousModeRef.current;
    const previousRect = previousRectRef.current;

    // On mini-player entry, wait until the snap hook has measured the compact
    // box and resolved its final corner. Measuring during the scale animation
    // would make getBoundingClientRect report the transformed (too large) box.
    if (mode !== "hidden" && !isTargetReady) return;

    if (!player || mode === "hidden") {
      animationRef.current?.cancel();
      animationRef.current = null;
      previousModeRef.current = mode;
      previousRectRef.current = null;
      setIsMorphing(false);
      return;
    }

    const currentRect = readVisualRect(player);
    previousModeRef.current = mode;
    previousRectRef.current = currentRect;

    const shouldMorph =
      currentRect &&
      previousRect &&
      previousMode !== "hidden" &&
      previousMode !== mode &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!shouldMorph) {
      if (!animationRef.current) setIsMorphing(false);
      return;
    }

    animationRef.current?.cancel();

    const animation = player.animate(
      [
        {
          transform: `translate(${previousRect.left - currentRect.left}px, ${previousRect.top - currentRect.top}px) scale(${previousRect.width / currentRect.width}, ${previousRect.height / currentRect.height})`,
          borderRadius: previousRect.borderRadius,
          boxShadow: previousRect.boxShadow,
        },
        {
          transform: "translate(0, 0) scale(1, 1)",
          borderRadius: currentRect.borderRadius,
          boxShadow: currentRect.boxShadow,
        },
      ],
      {
        duration: window.matchMedia("(max-width: 500px)").matches ? 400 : 460,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      },
    );

    animationRef.current = animation;
    setIsMorphing(true);

    animation.onfinish = () => {
      if (animationRef.current !== animation) return;
      animation.cancel();
      animationRef.current = null;
      setIsMorphing(false);
    };
  }, [isTargetReady, layoutKey, mode, playerRef]);

  useEffect(
    () => () => {
      animationRef.current?.cancel();
    },
    [],
  );

  return isMorphing;
}
