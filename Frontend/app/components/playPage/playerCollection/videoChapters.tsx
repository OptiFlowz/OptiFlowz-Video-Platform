import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CloseSVG } from "~/constants";
import type { VideoT } from "~/types";
import ChapterCard from "./chapterCard";
import { useI18n } from "~/i18n";

function useIsMobile(breakpoint = 500) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);

  return isMobile;
}

function VideoChapters({ props, onClose }: { props: VideoT; onClose: () => void }) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [playerTime, setPlayerTime] = useState(0);
  const isMobile = useIsMobile();

  const holderRef = useRef<HTMLDivElement>(null);
  const lastActiveIndexRef = useRef<number>(-1);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ seconds: number }>;
      const t = Number(ce.detail?.seconds);
      if (Number.isFinite(t)) setPlayerTime(t);
    };

    window.addEventListener("player:time", handler as EventListener);
    return () => window.removeEventListener("player:time", handler as EventListener);
  }, []);

  const headerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    const update = () => {
      const h = el.offsetHeight;
      document.documentElement.style.setProperty("--headerHeight", `${h + 10}px`);
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const chapters = useMemo(() => {
    return (props?.chapters ?? []).map((chapter) => ({
      ...chapter,
      startTime: Number(
        chapter?.startTime ?? (chapter as any)?.start_time ?? (chapter as any)?.time ?? 0
      ),
    }));
  }, [props?.chapters]);

  const activeIndex = useMemo(() => {
    if (!chapters.length) return -1;

    for (let i = chapters.length - 1; i >= 0; i--) {
      const start = Number(chapters[i]?.startTime ?? 0);
      if (playerTime >= start) return i;
    }
    return 0;
  }, [chapters, playerTime]);

  const chaptersArray = useMemo(() => {
    return chapters.map((ch, index) => {
      const nextStartTime = Number(chapters[index + 1]?.startTime ?? props?.duration_seconds ?? Infinity);

      return (
        <ChapterCard
          key={`chapter-${index}`}
          props={ch}
          thumbnail_url={props?.thumbnail_url}
          index={index}
          nextStartTime={nextStartTime}
          playerTime={playerTime}
        />
      );
    });
  }, [chapters, props?.thumbnail_url, props?.duration_seconds, playerTime]);

  useLayoutEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;

    if (activeIndex < 0) return;
    if (lastActiveIndexRef.current === activeIndex) return;

    lastActiveIndexRef.current = activeIndex;

    const activeEl = holder.querySelector(".chapterCard.active") as HTMLElement | null;
    if (!activeEl) return;

    const holderRect = holder.getBoundingClientRect();
    const elRect = activeEl.getBoundingClientRect();
    const padding = 15;
    const topWithinHolder = (elRect.top - holderRect.top) + holder.scrollTop;

    holder.scrollTo({
      top: topWithinHolder - padding,
      behavior: "smooth",
    });
  }, [activeIndex]);

  if (chapters.length == 0) return null;

  const handleClose = () => {
    if (!isMobile) {
      onClose();
      return;
    }

    setIsOpen(false);
    window.setTimeout(() => onClose(), 320);
  };

  return (
    <div className={`sidePlaylists sideChapters ${isOpen ? "" : "closed"}`}>
      <div ref={headerRef} className="playlistHeader">
        <span className="titleBar">
          <h2>{t("videoChapters")}</h2>
          <button onClick={handleClose} aria-label={t("close")}>
            {CloseSVG}
          </button>
        </span>
      </div>

      <div className="similar" ref={holderRef}>
        <div className="holder">
          {chaptersArray}
        </div>
      </div>
    </div>
  );
}

export default memo(VideoChapters);
