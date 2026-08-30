"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { VideoT } from "~/types";
import VideoPlayer from "~/components/playPage/playerCollection/muxPlayer";
import type MuxPlayerElement from "@mux/mux-player";
import { useFloatingMiniPlayer } from "./useFloatingMiniPlayer";
import {
  usePlayerMorphTransition,
  type PersistentPlayerMode,
} from "./usePlayerMorphTransition";

type PlayerSession = {
  video: VideoT;
  startTimeOverride?: number | null;
  forceAutoplay?: boolean;
  returnHref: string;
};

type PlayerRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type PersistentVideoContextValue = {
  activate: (session: PlayerSession) => void;
  setAnchor: (element: HTMLDivElement | null) => void;
};

const PersistentVideoContext = createContext<PersistentVideoContextValue | null>(null);

function getVideoPath(videoId: string) {
  return `/video/${videoId}`;
}

export function usePersistentVideo() {
  const context = useContext(PersistentVideoContext);

  if (!context) {
    throw new Error("usePersistentVideo must be used inside PersistentVideoProvider");
  }

  return context;
}

export default function PersistentVideoProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [anchor, setAnchorState] = useState<HTMLDivElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<PlayerRect | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMiniOpen, setIsMiniOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const sessionRef = useRef<PlayerSession | null>(null);
  const isPlayingRef = useRef(false);
  const playerElementRef = useRef<MuxPlayerElement | null>(null);
  const previousPathnameRef = useRef(pathname);
  const closeTimerRef = useRef<number | null>(null);

  const setAnchor = useCallback((element: HTMLDivElement | null) => {
    setAnchorState(element);
    if (!element) setAnchorRect(null);
  }, []);

  const activate = useCallback((nextSession: PlayerSession) => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsClosing(false);

    const current = sessionRef.current;
    const isNewVideo =
      current?.video.id !== nextSession.video.id ||
      current?.video.mux_playback_id !== nextSession.video.mux_playback_id;

    if (isNewVideo) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsMiniOpen(false);
    }

    sessionRef.current = nextSession;
    setSession(nextSession);
  }, []);

  const updateAnchorRect = useCallback(() => {
    if (!anchor) {
      setAnchorRect(null);
      return;
    }

    const rect = anchor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setAnchorRect(null);
      return;
    }

    setAnchorRect((current) => {
      const usesFixedMobilePlayer = window.matchMedia("(max-width: 500px)").matches;
      const next = {
        top: usesFixedMobilePlayer ? rect.top : rect.top + window.scrollY,
        left: usesFixedMobilePlayer ? rect.left : rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      };

      if (
        current &&
        Math.abs(current.top - next.top) < 0.5 &&
        Math.abs(current.left - next.left) < 0.5 &&
        Math.abs(current.width - next.width) < 0.5 &&
        Math.abs(current.height - next.height) < 0.5
      ) {
        return current;
      }

      return next;
    });
  }, [anchor]);

  useLayoutEffect(() => {
    if (!anchor) return;

    let frame = 0;
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateAnchorRect);
    };

    const recoverAnchorMeasurement = () => {
      if (document.visibilityState === "hidden") return;
      updateAnchorRect();
      scheduleUpdate();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recoverAnchorMeasurement();
      }
    };

    // Measure before the first paint. Relying only on rAF can leave the real
    // player hidden indefinitely when the page is backgrounded during mount.
    updateAnchorRect();
    scheduleUpdate();
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(anchor);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("focus", recoverAnchorMeasurement);
    window.addEventListener("pageshow", recoverAnchorMeasurement);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("focus", recoverAnchorMeasurement);
      window.removeEventListener("pageshow", recoverAnchorMeasurement);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [anchor, updateAnchorRect]);

  useEffect(() => {
    if (!session) {
      previousPathnameRef.current = pathname;
      return;
    }

    const activeVideoPath = getVideoPath(session.video.id);
    const previousPathname = previousPathnameRef.current;
    const isOnActiveVideo = pathname === activeVideoPath;
    const wasOnActiveVideo = previousPathname === activeVideoPath;
    const openedAnotherVideo = pathname.startsWith("/video/") && !isOnActiveVideo;

    if (openedAnotherVideo) {
      sessionRef.current = null;
      isPlayingRef.current = false;
      setSession(null);
      setIsPlaying(false);
      setIsMiniOpen(false);
    } else if (isOnActiveVideo && anchor && anchorRect) {
      setIsMiniOpen(false);
    } else if (wasOnActiveVideo) {
      if (isPlayingRef.current) {
        setIsMiniOpen(true);
      } else {
        sessionRef.current = null;
        setSession(null);
      }
    }

    previousPathnameRef.current = pathname;
  }, [anchor, anchorRect, pathname, session]);

  const handlePlayingChange = useCallback((playing: boolean) => {
    isPlayingRef.current = playing;
    setIsPlaying(playing);
  }, []);

  const handlePlayerElement = useCallback((player: MuxPlayerElement | null) => {
    playerElementRef.current = player;
  }, []);

  const closeMiniPlayer = useCallback(() => {
    if (isClosing) return;

    playerElementRef.current?.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsClosing(true);

    closeTimerRef.current = window.setTimeout(() => {
      sessionRef.current = null;
      setSession(null);
      setIsMiniOpen(false);
      setIsClosing(false);
      closeTimerRef.current = null;
    }, 190);
  }, [isClosing]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const expandMiniPlayer = useCallback(() => {
    if (!sessionRef.current) return;
    router.push(sessionRef.current.returnHref);
  }, [router]);

  const toggleMiniPlayback = useCallback(() => {
    const player = playerElementRef.current;
    if (!player) return;

    if (player.paused) {
      void player.play().catch(() => {});
    } else {
      player.pause();
    }
  }, []);

  const activeVideoPath = session ? getVideoPath(session.video.id) : null;
  const showFullPlayer = Boolean(
    session && activeVideoPath === pathname && anchor && anchorRect,
  );
  const showMiniPlayer = Boolean(
    session &&
      !showFullPlayer &&
      (isMiniOpen || (activeVideoPath !== pathname && isPlaying)),
  );
  const isVisible = showFullPlayer || showMiniPlayer;
  const floatingPlayer = useFloatingMiniPlayer(showMiniPlayer);
  const playerMode: PersistentPlayerMode = showFullPlayer
    ? "full"
    : showMiniPlayer
      ? "mini"
      : "hidden";
  const morphLayoutKey = showFullPlayer && anchorRect
    ? `full:${anchorRect.top}:${anchorRect.left}:${anchorRect.width}:${anchorRect.height}`
    : showMiniPlayer
      ? `mini:${floatingPlayer.position?.x ?? "default"}:${floatingPlayer.position?.y ?? "default"}`
      : "hidden";
  const isMorphing = usePlayerMorphTransition(
    floatingPlayer.miniPlayerRef,
    playerMode,
    morphLayoutKey,
    playerMode !== "mini" || floatingPlayer.isPositionReady,
  );

  const contextValue = useMemo(
    () => ({ activate, setAnchor }),
    [activate, setAnchor],
  );
  const miniPlayerByline =
    session?.video.people
      ?.map((person) => person.name?.trim())
      .filter(Boolean)
      .join(", ") || session?.video.uploader_name;

  return (
    <PersistentVideoContext.Provider value={contextValue}>
      {children}

      <div ref={floatingPlayer.safeAreaRef} className="persistent-video-safe-area" aria-hidden="true" />

      {session ? (
        <aside
          ref={floatingPlayer.miniPlayerRef}
          className={`persistent-video-player ${showMiniPlayer ? "persistent-video-player--mini" : "persistent-video-player--full"} ${isVisible ? "is-visible" : ""} ${floatingPlayer.isDragging ? "is-dragging" : ""} ${isMorphing ? "is-morphing" : ""} ${isClosing ? "is-closing" : ""}`}
          style={
            showFullPlayer && anchorRect
              ? {
                  top: anchorRect.top,
                  left: anchorRect.left,
                  width: anchorRect.width,
                  height: anchorRect.height,
                }
              : showMiniPlayer && floatingPlayer.position
                ? {
                    top: floatingPlayer.position.y,
                    left: floatingPlayer.position.x,
                    right: "auto",
                    bottom: "auto",
                  }
              : undefined
          }
          aria-label={showMiniPlayer ? `Now playing: ${session.video.title}` : undefined}
          aria-hidden={!isVisible}
          {...(showMiniPlayer ? floatingPlayer.dragSurfaceProps : {})}
        >
          {showMiniPlayer ? (
            <div className="persistent-video-player__actions">
              <button
                type="button"
                className="persistent-video-player__action persistent-video-player__desktop-expand"
                onClick={expandMiniPlayer}
                aria-label="Open full video"
                title="Open full video"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" />
                </svg>
              </button>
              <button
                type="button"
                className="persistent-video-player__action"
                onClick={closeMiniPlayer}
                aria-label="Close mini player"
                title="Close mini player"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          ) : null}

          {showMiniPlayer ? (
            <button
              type="button"
              className="persistent-video-player__expand-surface"
              onClick={expandMiniPlayer}
              aria-label={`Open ${session.video.title}`}
            />
          ) : null}

          {showMiniPlayer ? (
            <button
              type="button"
              className="persistent-video-player__mobile-toggle"
              onClick={toggleMiniPlayback}
              aria-label={isPlaying ? "Pause video" : "Play video"}
              title={isPlaying ? "Pause video" : "Play video"}
            >
              {isPlaying ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14M16 5v14" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path className="fill" d="m9 6 9 6-9 6Z" />
                </svg>
              )}
            </button>
          ) : null}

          <div className="persistent-video-player__media">
            <VideoPlayer
              key={session.video.view?.view_id ?? session.video.id ?? session.video.mux_playback_id}
              playbackId={session.video.mux_playback_id}
              currentTimee={
                session.startTimeOverride != null
                  ? session.startTimeOverride
                  : session.video.percentage_watched < 95
                    ? session.video.progress_seconds
                    : 0
              }
              videoId={session.video.id}
              videoTitle={session.video.title}
              view_id={session.video.view?.view_id}
              last_seq={session.video.view?.last_seq}
              chapters={session.video.chapters}
              forceAutoplay={session.forceAutoplay}
              onPlayingChange={handlePlayingChange}
              onPlayerElement={handlePlayerElement}
              compactControls={showMiniPlayer}
            />
          </div>

          {showMiniPlayer ? (
            <button
              type="button"
              className="persistent-video-player__details"
              onClick={expandMiniPlayer}
              aria-label={`Open ${session.video.title}`}
            >
              <strong>{session.video.title}</strong>
              <span>{miniPlayerByline}</span>
            </button>
          ) : null}
        </aside>
      ) : null}
    </PersistentVideoContext.Provider>
  );
}
