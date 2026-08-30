import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChaptersSVG, CloseSVG, TranscriptSVG } from "~/constants";
import { env } from "~/env";
import { formatDuration, getToken } from "~/functions";
import type { VideoT } from "~/types";
import ChapterCard from "./chapterCard";
import { useI18n } from "~/i18n";
import {
  TRANSCRIPT_EVENT,
  TRANSCRIPT_REQUEST_EVENT,
  parseVttTranscript,
  type TranscriptCue,
  type TranscriptEventDetail,
} from "./transcript";

type PanelView = "chapters" | "transcript";
type TranscriptStatus = "loading" | "ready" | "empty";

function useIsMobile(breakpoint = 500) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);

  return isMobile;
}

function VideoChapters({
  props,
  onClose,
  initialView = "chapters",
}: {
  props: VideoT;
  onClose: () => void;
  initialView?: PanelView;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [playerTime, setPlayerTime] = useState(0);
  const [activeView, setActiveView] = useState<PanelView>(initialView);
  const [transcriptCues, setTranscriptCues] = useState<TranscriptCue[]>([]);
  const [transcriptStatus, setTranscriptStatus] = useState<TranscriptStatus>("loading");
  const [transcriptLanguage, setTranscriptLanguage] = useState("en");
  const isMobile = useIsMobile();

  const holderRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const lastActiveChapterRef = useRef<number>(-1);
  const lastActiveCueRef = useRef<number>(-1);
  const transcriptLanguageRef = useRef("en");
  const fullTranscriptLanguageRef = useRef<string | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handlePlayerTime = (event: Event) => {
      const detail = (event as CustomEvent<{ seconds: number }>).detail;
      const seconds = Number(detail?.seconds);
      if (Number.isFinite(seconds)) setPlayerTime(seconds);
    };

    const handleTranscript = (event: Event) => {
      const detail = (event as CustomEvent<TranscriptEventDetail>).detail;
      const language = (detail?.language || "en").split("-")[0].toLowerCase();
      if (language !== transcriptLanguageRef.current) {
        transcriptLanguageRef.current = language;
        fullTranscriptLanguageRef.current = null;
        setTranscriptLanguage(language);
      }
      if (fullTranscriptLanguageRef.current === language) return;

      const cues = detail?.cues ?? [];
      setTranscriptCues(cues);
      setTranscriptStatus(cues.length > 0 ? "ready" : detail?.hasTrack ? "loading" : "empty");
    };

    window.addEventListener("player:time", handlePlayerTime);
    window.addEventListener(TRANSCRIPT_EVENT, handleTranscript);
    window.dispatchEvent(new Event(TRANSCRIPT_REQUEST_EVENT));

    return () => {
      window.removeEventListener("player:time", handlePlayerTime);
      window.removeEventListener(TRANSCRIPT_EVENT, handleTranscript);
    };
  }, []);

  useEffect(() => {
    if (activeView !== "transcript") return;

    const token = getToken();
    if (!token) return;

    const controller = new AbortController();
    const language = transcriptLanguage.split("-")[0].toLowerCase();

    const loadFullTranscript = async () => {
      try {
        const response = await fetch(
          `${env.apiBaseUrl || ""}/api/video-moderation/subtitle/${props.id}?lang=${encodeURIComponent(language)}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );
        if (!response.ok) return;

        const cues = parseVttTranscript(await response.text());
        if (!cues.length || controller.signal.aborted) return;

        fullTranscriptLanguageRef.current = language;
        setTranscriptCues(cues);
        setTranscriptStatus("ready");
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Failed to load the full transcript:", error);
        }
      }
    };

    void loadFullTranscript();
    return () => controller.abort();
  }, [activeView, props.id, transcriptLanguage]);

  useEffect(() => {
    if (activeView !== "transcript" || transcriptCues.length > 0) return;

    window.dispatchEvent(new Event(TRANSCRIPT_REQUEST_EVENT));
    const timeout = window.setTimeout(() => setTranscriptStatus("empty"), 3500);
    return () => window.clearTimeout(timeout);
  }, [activeView, transcriptCues.length]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const update = () => {
      document.documentElement.style.setProperty("--headerHeight", `${header.offsetHeight + 10}px`);
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const chapters = useMemo(() => {
    return (props?.chapters ?? []).map((chapter) => ({
      ...chapter,
      startTime: Number(
        chapter?.startTime ?? (chapter as any)?.start_time ?? (chapter as any)?.time ?? 0,
      ),
    }));
  }, [props?.chapters]);

  const activeChapterIndex = useMemo(() => {
    if (!chapters.length) return -1;

    for (let index = chapters.length - 1; index >= 0; index -= 1) {
      if (playerTime >= Number(chapters[index]?.startTime ?? 0)) return index;
    }
    return 0;
  }, [chapters, playerTime]);

  const activeCueIndex = useMemo(() => {
    return transcriptCues.findIndex(
      (cue) => playerTime >= cue.startTime && playerTime < cue.endTime,
    );
  }, [playerTime, transcriptCues]);

  const chaptersArray = useMemo(() => {
    return chapters.map((chapter, index) => {
      const nextStartTime = Number(
        chapters[index + 1]?.startTime ?? props?.duration_seconds ?? Infinity,
      );

      return (
        <ChapterCard
          key={`chapter-${index}`}
          props={chapter}
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
    if (!holder || activeView !== "chapters" || activeChapterIndex < 0) return;
    if (lastActiveChapterRef.current === activeChapterIndex) return;

    lastActiveChapterRef.current = activeChapterIndex;
    const activeElement = holder.querySelector<HTMLElement>(".chapterCard.active");
    if (!activeElement) return;

    const holderBounds = holder.getBoundingClientRect();
    const elementBounds = activeElement.getBoundingClientRect();
    holder.scrollTo({
      top: elementBounds.top - holderBounds.top + holder.scrollTop - 15,
      behavior: "smooth",
    });
  }, [activeChapterIndex, activeView]);

  useLayoutEffect(() => {
    const holder = holderRef.current;
    if (!holder || activeView !== "transcript" || activeCueIndex < 0) return;
    if (lastActiveCueRef.current === activeCueIndex) return;

    lastActiveCueRef.current = activeCueIndex;
    const activeElement = holder.querySelector<HTMLElement>(".transcriptCue.active");
    if (!activeElement) return;

    const holderBounds = holder.getBoundingClientRect();
    const elementBounds = activeElement.getBoundingClientRect();
    holder.scrollTo({
      top: elementBounds.top - holderBounds.top + holder.scrollTop - 15,
      behavior: "smooth",
    });
  }, [activeCueIndex, activeView]);

  if (chapters.length === 0) return null;

  const handleClose = () => {
    if (!isMobile) {
      onClose();
      return;
    }

    setIsOpen(false);
    window.setTimeout(() => onClose(), 320);
  };

  const selectView = (view: PanelView) => {
    setActiveView(view);
    holderRef.current?.scrollTo({ top: 0 });
    if (view === "transcript") window.dispatchEvent(new Event(TRANSCRIPT_REQUEST_EVENT));
  };

  const seekTo = (seconds: number) => {
    window.dispatchEvent(new CustomEvent("player:seek", { detail: { seconds } }));
  };

  return (
    <div className={`sidePlaylists sideChapters ${isOpen ? "" : "closed"}`}>
      <div ref={headerRef} className="playlistHeader">
        <span className="titleBar">
          <h2>{t("inThisVideo")}</h2>
          <button onClick={handleClose} aria-label={t("close")}>
            {CloseSVG}
          </button>
        </span>

        <span className="tagsHolder inVideoTabs">
          <span className="tags" role="tablist" aria-label={t("inThisVideo")}>
            <button type="button" className={activeView === "chapters" ? "whiteTag" : ""} role="tab" aria-selected={activeView === "chapters"} onClick={() => selectView("chapters")}>
              {ChaptersSVG}
              {t("chapters")}
            </button>
            <button type="button" className={activeView === "transcript" ? "whiteTag" : ""} role="tab" aria-selected={activeView === "transcript"} onClick={() => selectView("transcript")}>
              {TranscriptSVG}
              {t("transcript")}
            </button>
          </span>
        </span>
      </div>

      <div className="similar" ref={holderRef} role="tabpanel">
        {activeView === "chapters" ? (
          <div className="holder">{chaptersArray}</div>
        ) : (
          <div className="transcriptPanel">
            {transcriptStatus === "loading" ? (
              <p className="transcriptMessage">{t("loadingTranscript")}</p>
            ) : transcriptStatus === "empty" ? (
              <p className="transcriptMessage">{t("transcriptUnavailable")}</p>
            ) : (
              <div className="transcriptList">
                {transcriptCues.map((cue, index) => {
                  const isActive = index === activeCueIndex;
                  return (
                    <button type="button" key={cue.id} className={`playCard chapterCard transcriptCue ${isActive ? "active" : ""}`} onClick={() => seekTo(cue.startTime)}>
                      <span className="chapterStartTime transcriptTimestamp">{formatDuration(Math.floor(cue.startTime))}</span>
                      <span className="transcriptText">{cue.text}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(VideoChapters);
