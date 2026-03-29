import { useEffect, useState, type CSSProperties, type RefObject } from "react";

type Params = {
  containerRef: RefObject<HTMLElement | null>;
  stickyRef: RefObject<HTMLElement | null>;
  boundaryRef?: RefObject<HTMLElement | null>;
  anchorRef?: RefObject<HTMLElement | null>;
  lockHeightToContainer?: boolean;
  disabledBelow?: number;
  topOffset?: number;
  bottomGap?: number;
};

export function useConstrainedSticky({
  containerRef,
  stickyRef,
  boundaryRef,
  anchorRef,
  lockHeightToContainer = false,
  disabledBelow = 800,
  topOffset = 89,
  bottomGap = 16,
}: Params) {
  const [stickyStyle, setStickyStyle] = useState<CSSProperties>({});

  useEffect(() => {
    let frameId = 0;

    const updateStickyPosition = () => {
      const containerEl = containerRef.current;
      const stickyEl = stickyRef.current;
      if (!containerEl || !stickyEl) return;

      if (window.innerWidth <= disabledBelow) {
        setStickyStyle({});
        return;
      }

      const containerRect = containerEl.getBoundingClientRect();
      const anchorEl =
        anchorRef?.current ?? (containerEl.closest("main") as HTMLElement | null);
      const boundaryEl = boundaryRef?.current ?? document.querySelector("footer");
      const stickyHeight = stickyEl.offsetHeight;
      const lockedHeight = lockHeightToContainer
        ? `${containerEl.offsetHeight}px`
        : undefined;

      if (containerRect.top > topOffset) {
        setStickyStyle({});
        return;
      }

      let computedTop = topOffset;
      let shouldPinToBoundary = false;

      if (boundaryEl) {
        const boundaryRect = boundaryEl.getBoundingClientRect();
        const boundaryLimitedTop = boundaryRect.top - stickyHeight - bottomGap;
        computedTop = Math.min(topOffset, boundaryLimitedTop);
        shouldPinToBoundary = boundaryLimitedTop <= topOffset;
      }

      if (shouldPinToBoundary && anchorEl) {
        const anchorRect = anchorEl.getBoundingClientRect();
        const boundaryRect = boundaryEl!.getBoundingClientRect();
        const pinnedTop =
          boundaryRect.top - anchorRect.top - stickyHeight - bottomGap;
        const pinnedLeft = containerRect.left - anchorRect.left;

        setStickyStyle({
          position: "absolute",
          top: `${pinnedTop}px`,
          left: `${pinnedLeft}px`,
          width: `${containerEl.offsetWidth}px`,
          height: lockedHeight,
        });
        return;
      }

      setStickyStyle({
        position: "fixed",
        top: `${computedTop}px`,
        left: `${containerRect.left}px`,
        width: `${containerEl.offsetWidth}px`,
        height: lockedHeight,
      });
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateStickyPosition);
    };

    const boundaryEl = boundaryRef?.current ?? document.querySelector("footer");
    const anchorEl =
      anchorRef?.current ??
      (containerRef.current?.closest("main") as HTMLElement | null);
    const resizeObserver = new ResizeObserver(() => {
      scheduleUpdate();
    });

    if (containerRef.current) resizeObserver.observe(containerRef.current);
    if (stickyRef.current) resizeObserver.observe(stickyRef.current);
    if (boundaryEl) resizeObserver.observe(boundaryEl);
    if (anchorEl) resizeObserver.observe(anchorEl);
    resizeObserver.observe(document.body);

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [
    anchorRef,
    bottomGap,
    boundaryRef,
    containerRef,
    disabledBelow,
    lockHeightToContainer,
    stickyRef,
    topOffset,
  ]);

  return stickyStyle;
}
