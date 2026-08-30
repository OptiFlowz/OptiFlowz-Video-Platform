// VideoPlayer.tsx
import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from "react";
import MuxPlayer from "@mux/mux-player-react";
import type MuxPlayerElement from "@mux/mux-player";
import { env } from "~/env";
import type { ChapterT } from "~/types";
import { getToken } from "~/functions";
import { loadMediaTheme, styleMuxPlayerCaptions } from "./loadMediaTheme";
import {
  publishPlayerTranscript,
  TRANSCRIPT_REQUEST_EVENT,
} from "./transcript";

interface VideoPlayerProps {
  playbackId: string;
  videoId: string;
  videoTitle: string;
  apiBaseUrl?: string;
  autoplay?: boolean;
  accentColor?: string;
  currentTimee?: number;
  style?: React.CSSProperties;
  view_id?: string;
  last_seq?: number;
  chapters: ChapterT[];
  onProgressSaved?: (seconds: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onPlayerElement?: (player: MuxPlayerElement | null) => void;
  compactControls?: boolean;
  forceAutoplay?: boolean;
}

const EMPTY_STYLE: React.CSSProperties = {};

function getNativeVideo(player: MuxPlayerElement | null) {
  return (
    player?.media?.nativeEl ??
    player?.shadowRoot
      ?.querySelector("mux-video")
      ?.shadowRoot?.querySelector("video") ??
    null
  );
}

export default function VideoPlayer({
  playbackId,
  videoId,
  videoTitle,
  apiBaseUrl = env.apiBaseUrl,
  autoplay = true,
  accentColor = "var(--accentBlue2)",
  style = EMPTY_STYLE,
  currentTimee,
  view_id,
  last_seq,
  chapters,
  onProgressSaved,
  onPlayingChange,
  onPlayerElement,
  compactControls = false,
  forceAutoplay = false,
}: VideoPlayerProps) {
  const playerRef = useRef<MuxPlayerElement | null>(null);

  const setPlayerRef = useCallback((player: MuxPlayerElement | null) => {
    playerRef.current = player;
    onPlayerElement?.(player);
  }, [onPlayerElement]);

  // ---------------------------
  // METADATA / INITIAL SEEK
  // ---------------------------
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isThemeReady, setIsThemeReady] = useState(false);
  const [isAutoplayMuted, setIsAutoplayMuted] = useState(false);
  const didInitialSeek = useRef(false);
  const isPlayerReadyRef = useRef(false);
  const recoveryAttemptsRef = useRef(0);
  const recoveryTimersRef = useRef<number[]>([]);
  const wasPageHiddenRef = useRef(false);
  const resumeAfterRecoveryRef = useRef(false);
  const lastKnownTimeRef = useRef(Number.isFinite(currentTimee) ? (currentTimee ?? 0) : 0);
  const pendingRecoveryTimeRef = useRef<number | null>(null);
  const previousCompactControlsRef = useRef(compactControls);

  const updatePlayerReady = useCallback((ready: boolean) => {
    isPlayerReadyRef.current = ready;
    setIsPlayerReady(ready);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadMediaTheme().then(() => {
      if (!cancelled) {
        setIsThemeReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isThemeReady) return;

    const frame = requestAnimationFrame(() => {
      styleMuxPlayerCaptions(playerRef.current);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isThemeReady, playbackId]);

  useEffect(() => {
    setMetadataLoaded(false);
    updatePlayerReady(false);
    setIsAutoplayMuted(false);
    didInitialSeek.current = false;
    recoveryAttemptsRef.current = 0;
    pendingRecoveryTimeRef.current = null;
    lastKnownTimeRef.current = Number.isFinite(currentTimee) ? (currentTimee ?? 0) : 0;
  }, [playbackId, updatePlayerReady]);

  const clearRecoveryTimers = useCallback(() => {
    recoveryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    recoveryTimersRef.current = [];
  }, []);

  const recoverPlayer = useCallback((allowReload: boolean) => {
    const player = playerRef.current;
    if (!player) return;

    const video = getNativeVideo(player);
    const currentTime = Number.isFinite(video?.currentTime)
      ? (video?.currentTime ?? 0)
      : Number.isFinite(player.currentTime)
        ? player.currentTime
      : lastKnownTimeRef.current;
    const readyState = video?.readyState ?? player.readyState ?? 0;
    const videoWidth = video?.videoWidth ?? player.videoWidth ?? 0;
    const hasRenderableFrame = readyState >= 2 && videoWidth > 0;

    if (Number.isFinite(currentTime)) {
      lastKnownTimeRef.current = currentTime;
    }

    if (hasRenderableFrame) {
      recoveryAttemptsRef.current = 0;
      setMetadataLoaded(true);
      updatePlayerReady(true);
      styleMuxPlayerCaptions(player);

      if (resumeAfterRecoveryRef.current) {
        resumeAfterRecoveryRef.current = false;
        void player.play().catch(() => {});
      } else if (video?.paused && Number.isFinite(video.currentTime)) {
        // Re-present a paused frame after the browser recreates its video
        // compositor layer during a tab or full/mini transition.
        const maxTime = Number.isFinite(video.duration)
          ? Math.max(video.duration - 0.01, 0)
          : video.currentTime + 0.01;
        const repaintTime = Math.min(video.currentTime + 0.01, maxTime);
        if (repaintTime !== video.currentTime) video.currentTime = repaintTime;
      }
      return;
    }

    updatePlayerReady(false);
    if (!allowReload || recoveryAttemptsRef.current >= 2) return;

    recoveryAttemptsRef.current += 1;
    pendingRecoveryTimeRef.current = lastKnownTimeRef.current;
    setMetadataLoaded(false);
    player.load();
  }, [updatePlayerReady]);

  const schedulePlayerRecovery = useCallback(() => {
    clearRecoveryTimers();
    recoveryTimersRef.current = [
      window.setTimeout(() => recoverPlayer(false), 0),
      window.setTimeout(() => recoverPlayer(true), 900),
    ];
  }, [clearRecoveryTimers, recoverPlayer]);

  useEffect(() => {
    const capturePlaybackState = () => {
      const player = playerRef.current;
      if (!player) return;
      const video = getNativeVideo(player);
      resumeAfterRecoveryRef.current = !(video?.paused ?? player.paused);
      const currentTime = video?.currentTime ?? player.currentTime;
      if (Number.isFinite(currentTime)) {
        lastKnownTimeRef.current = currentTime;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasPageHiddenRef.current = true;
        capturePlaybackState();
        return;
      }

      if (!wasPageHiddenRef.current) return;
      wasPageHiddenRef.current = false;
      schedulePlayerRecovery();
    };

    const handlePageHide = () => {
      wasPageHiddenRef.current = true;
      capturePlaybackState();
    };

    const handlePageShow = () => {
      if (!wasPageHiddenRef.current) return;
      wasPageHiddenRef.current = false;
      schedulePlayerRecovery();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      clearRecoveryTimers();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [clearRecoveryTimers, schedulePlayerRecovery]);

  useEffect(() => {
    if (previousCompactControlsRef.current === compactControls) return;
    previousCompactControlsRef.current = compactControls;

    const player = playerRef.current;
    if (player) {
      const video = getNativeVideo(player);
      resumeAfterRecoveryRef.current = !(video?.paused ?? player.paused);
      const currentTime = video?.currentTime ?? player.currentTime;
      if (Number.isFinite(currentTime)) {
        lastKnownTimeRef.current = currentTime;
      }
    }

    schedulePlayerRecovery();
  }, [compactControls, schedulePlayerRecovery]);

  useEffect(() => {
    if (!isThemeReady) return;

    const watchdog = window.setTimeout(() => {
      if (!isPlayerReadyRef.current && document.visibilityState === "visible") {
        recoverPlayer(true);
      }
    }, 15000);

    return () => window.clearTimeout(watchdog);
  }, [isThemeReady, playbackId, recoverPlayer]);

  useEffect(() => {
    const player = playerRef.current;
    const video = player?.media?.nativeEl;
    if (!player || !video || !metadataLoaded) return;

    const trackedTracks = new Set<TextTrack>();
    let lastTranscriptSignature = "";
    let pollingAttempts = 0;

    const publishTranscript = () => publishPlayerTranscript(player);

    const publishIfChanged = () => {
      const tracks = Array.from(video.textTracks).filter(
        (track) => track.kind === "captions" || track.kind === "subtitles",
      );
      const signature = tracks
        .map((track) => `${track.language}:${track.mode}:${track.cues?.length ?? -1}`)
        .join("|");

      if (signature === lastTranscriptSignature) return;
      lastTranscriptSignature = signature;
      publishTranscript();
    };

    const syncTracks = () => {
      Array.from(video.textTracks).forEach((track) => {
        if (trackedTracks.has(track)) return;
        trackedTracks.add(track);
        track.addEventListener("cuechange", publishIfChanged);
      });
      publishIfChanged();
    };

    const handleTranscriptRequest = () => publishTranscript();
    const handleTrackChange = () => {
      lastTranscriptSignature = "";
      syncTracks();
    };

    window.addEventListener(TRANSCRIPT_REQUEST_EVENT, handleTranscriptRequest);
    video.textTracks.addEventListener("addtrack", handleTrackChange);
    video.textTracks.addEventListener("removetrack", handleTrackChange);
    video.textTracks.addEventListener("change", handleTrackChange);
    syncTracks();

    const pollingTimer = window.setInterval(() => {
      pollingAttempts += 1;
      syncTracks();
      if (pollingAttempts >= 20) window.clearInterval(pollingTimer);
    }, 500);

    return () => {
      window.clearInterval(pollingTimer);
      window.removeEventListener(TRANSCRIPT_REQUEST_EVENT, handleTranscriptRequest);
      video.textTracks.removeEventListener("addtrack", handleTrackChange);
      video.textTracks.removeEventListener("removetrack", handleTrackChange);
      video.textTracks.removeEventListener("change", handleTrackChange);
      trackedTracks.forEach((track) => {
        track.removeEventListener("cuechange", publishIfChanged);
      });
    };
  }, [metadataLoaded, playbackId]);

  useEffect(() => {
    const el = playerRef.current;
    if (!el || !metadataLoaded || !isPlayerReady || (!autoplay && !forceAutoplay)) return;

    let cancelled = false;

    const tryAutoplay = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (cancelled) return;

      try {
        await el.play?.();
      } catch {
        if (!forceAutoplay || cancelled) return;

        try {
          el.muted = true;
          setIsAutoplayMuted(true);
          await el.play?.();
        } catch {
          // Browser autoplay policy can still require a user gesture.
        }
      }
    };

    void tryAutoplay();

    return () => {
      cancelled = true;
    };
  }, [autoplay, forceAutoplay, isPlayerReady, metadataLoaded, playbackId]);

  // External seek listener
  useEffect(() => {
    const handler = (e: any) => {
      const el = playerRef.current;
      const seconds = e.detail?.seconds;
      if (!Number.isFinite(seconds)) return;
      if (!el) return;

      el.currentTime = seconds;
      el.play?.().catch?.(() => {});
    };

    const disableContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    }

    window.addEventListener("player:seek", handler as any);
    playerRef.current?.addEventListener("contextmenu", disableContextMenu);
    
    return () => {
      window.removeEventListener("player:seek", handler as any);
      playerRef.current?.removeEventListener("contextmenu", disableContextMenu);
    }
  }, []);

  const sortedChapters = useMemo(() => {
    return (chapters ?? [])
      .map((c: any) => ({
        title: String(c.title ?? c.name ?? c.value ?? ""),
        startTime: Number(c.startTime ?? c.start_time ?? c.time ?? 0),
      }))
      .filter((c: any) => Number.isFinite(c.startTime) && c.title.length > 0)
      .sort((a: any, b: any) => a.startTime - b.startTime);
  }, [chapters]);

  const getActiveChapter = useCallback(
    (t: number) => {
      if (!Number.isFinite(t) || sortedChapters.length === 0) {
        return {
          chapterIndex: "-/-",
          chapterName: undefined as string | undefined,
        };
      }

      let idx = -1;
      for (let i = 0; i < sortedChapters.length; i++) {
        if (sortedChapters[i].startTime <= t) idx = i;
        else break;
      }

      return {
        chapterIndex: `${idx + 1}/${sortedChapters.length}`,
        chapterName: idx >= 0 ? sortedChapters[idx].title : undefined,
      };
    },
    [sortedChapters]
  );

  // Add mux chapters after metadata is loaded
  const muxChapters = useMemo(
    () =>
      (chapters ?? [])
        .map((c: any) => ({
          startTime: Number(c.startTime ?? c.start_time ?? c.time ?? 0),
          endTime: c.endTime ?? c.end_time ?? undefined,
          value: String(c.value ?? c.title ?? c.name ?? ""),
        }))
        .filter((c) => Number.isFinite(c.startTime) && c.value.length > 0),
    [chapters]
  );

  useEffect(() => {
    const el = playerRef.current;
    if (!el || !metadataLoaded || muxChapters.length === 0) return;
    try {
      el.addChapters(muxChapters);
    } catch {
      // ignore
    }
  }, [metadataLoaded, muxChapters]);

  // Initial seek to saved time (once)
  useEffect(() => {
    const el = playerRef.current;
    if (!el) return;
    if (!metadataLoaded) return;
    if (didInitialSeek.current) return;

    const start = Number.isFinite(currentTimee) ? (currentTimee ?? 0) : 0;
    if (start > 0) el.currentTime = start;

    didInitialSeek.current = true;

    const { chapterIndex, chapterName } = getActiveChapter(start);
    window.dispatchEvent(
      new CustomEvent("player:time", {
        detail: {
          seconds: start,
          chapterName,
          chapterIndex,
        },
      })
    );
  }, [metadataLoaded, currentTimee, getActiveChapter, playbackId]);

  // ---------------------------
  // PROGRESS SAVING (every ~10s or seek)
  // ---------------------------
  const lastSentProgressRef = useRef<number>(currentTimee || 0);

  const sendProgress = useCallback(
    async (progressSeconds: number) => {
      if (!videoId) return;

      const token = getToken();
      if (!token) return;

      try {
        await fetch(`${apiBaseUrl}/api/videos/${videoId}/progress`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ progressSeconds: Math.floor(progressSeconds) }),
        });

        onProgressSaved?.(Math.floor(progressSeconds));
      } catch {
        // best effort
      }
    },
    [apiBaseUrl, videoId, onProgressSaved]
  );

  // Ako nema currentTimee, upiši 0 jednom
  useEffect(() => {
    if (currentTimee == null) void sendProgress(0);
  }, [currentTimee, sendProgress]);

  const handleTimeUpdate = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    const current = player.currentTime;
    if (Number.isFinite(current)) lastKnownTimeRef.current = current;
    const diff = current - lastSentProgressRef.current;

    const { chapterIndex, chapterName } = getActiveChapter(current);
    window.dispatchEvent(
      new CustomEvent("player:time", {
        detail: {
          seconds: current,
          chapterName,
          chapterIndex,
        },
      })
    );

    // Pošalji ako je seek ili prošlo 10s
    if (Math.abs(diff) >= 10) {
      void sendProgress(current);
      lastSentProgressRef.current = current;
    }
  }, [sendProgress, getActiveChapter]);

  // ---------------------------
  // HEARTBEAT (watch time)
  // ---------------------------
  const hbIntervalRef = useRef<number | null>(null);
  const hbIsPlayingRef = useRef<boolean>(false);

  // novo: pamti poslednje poslato stanje
  const hbLastSentPlayingRef = useRef<boolean | null>(null);

  // ključ: seq nikad unazad
  const hbSeqRef = useRef<number>(Number.isFinite(last_seq) ? last_seq ?? 0 : 0);
  const hbViewIdRef = useRef<string | null>(view_id ?? null);

  // cache token
  const hbTokenRef = useRef<string | null>(null);
  useEffect(() => {
    hbTokenRef.current = getToken() ?? null;
  }, []);

  // sync sa server last_seq: reset za novi view, ali u istom view-u nikad unazad
  useEffect(() => {
    const serverSeq =
      typeof last_seq === "number" && Number.isFinite(last_seq) ? last_seq : 0;

    if (hbViewIdRef.current !== view_id) {
      hbViewIdRef.current = view_id ?? null;
      hbSeqRef.current = serverSeq;
      hbLastSentPlayingRef.current = null;
      return;
    }
    hbSeqRef.current = Math.max(hbSeqRef.current, serverSeq);
  }, [last_seq, view_id]);

  const stopHeartbeat = useCallback(() => {
    if (hbIntervalRef.current != null) {
      clearInterval(hbIntervalRef.current);
      hbIntervalRef.current = null;
    }
  }, []);

  const sendHeartbeat = useCallback(
    async (isPlaying: boolean, force = false) => {
      // DEDUPE samo za PAUSE (false)
      if (!force && isPlaying === false && hbLastSentPlayingRef.current === false) {
        return;
      }

      const token = hbTokenRef.current ?? getToken();
      if (!view_id) return;
      if (token) hbTokenRef.current = token;

      const nextSeq = (hbSeqRef.current || 0) + 1;
      hbSeqRef.current = nextSeq;

      const payload = { view_id, seq: nextSeq, is_playing: isPlaying };
      const heartbeatHeaders = new Headers({
        "Content-Type": "application/json",
      });
      if (token) heartbeatHeaders.set("Authorization", `Bearer ${token}`);

      try {
        await fetch(`${apiBaseUrl}/api/videos/heartbeat`, {
          method: "POST",
          headers: heartbeatHeaders,
          body: JSON.stringify(payload),
          keepalive: true,
        });

        hbLastSentPlayingRef.current = isPlaying;
      } catch {
        // best effort
      }
    },
    [apiBaseUrl, view_id]
  );

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();

    hbIntervalRef.current = window.setInterval(() => {
      // interval šalje samo dok je PLAYING (true), jer ga gasimo na pause
      void sendHeartbeat(true);
    }, 10000);
  }, [sendHeartbeat, stopHeartbeat]);

  // cleanup
  useEffect(() => {
    return () => {
      const wasPlaying = hbIsPlayingRef.current;
      stopHeartbeat();
      hbIsPlayingRef.current = false;
      if (wasPlaying) void sendHeartbeat(false, true); // force jednom na izlazu
    };
  }, [sendHeartbeat, stopHeartbeat]);

  function playNextVideoIfAutoPlayOn() {
    const autoLocal = localStorage.getItem("autoplay");
    const autoplayEnabled = autoLocal !== "false";
    if (!autoplayEnabled) return;

    document.querySelector<HTMLAnchorElement>(".nextVideo")?.click();
  }

  const handlePlay = useCallback(() => {
    resumeAfterRecoveryRef.current = false;
    hbIsPlayingRef.current = true;
    onPlayingChange?.(true);
    void sendHeartbeat(true, true); // force odmah
    startHeartbeat();               // interval radi samo u play-u
  }, [onPlayingChange, sendHeartbeat, startHeartbeat]);

  const handlePause = useCallback(() => {
    resumeAfterRecoveryRef.current = false;
    hbIsPlayingRef.current = false;
    onPlayingChange?.(false);
    stopHeartbeat();                // PREKINI interval da ne šalje false non-stop
    void sendHeartbeat(false, true); // pošalji false samo jednom
  }, [onPlayingChange, sendHeartbeat, stopHeartbeat]);

  const handleEnded = useCallback(() => {
    onPlayingChange?.(false);
    playNextVideoIfAutoPlayOn();
  }, [onPlayingChange]);

  // Pošalji progress pri unmount (ako ima novog)
  useEffect(() => {
    return () => {
      const player = playerRef.current;
      if (player && player.currentTime > lastSentProgressRef.current + 1) {
        void sendProgress(player.currentTime);
      }
    };
  }, [sendProgress]);

  return (
    <div id="playerCanvas" style={{ height: "100%" }}>
      {!isPlayerReady && (
        <div className="player-skeleton" aria-hidden="true">
          <div className="player-skeleton__controls">
            <span className="player-skeleton__chip player-skeleton__chip--wide"></span>
            <span className="player-skeleton__chip"></span>
            <span className="player-skeleton__chip player-skeleton__chip--short"></span>
          </div>
        </div>
      )}
      {isThemeReady && (
        <MuxPlayer
          theme="optiflowz-theme"
          themeProps={{
            videotitlee: videoTitle,
            chapterLenght: chapters?.length || 0,
            compact: compactControls,
          }}
          onLoadedMetadata={() => {
            styleMuxPlayerCaptions(playerRef.current);
            const recoveryTime = pendingRecoveryTimeRef.current;
            if (recoveryTime != null && playerRef.current) {
              const video = getNativeVideo(playerRef.current);
              if (video) video.currentTime = recoveryTime;
              else playerRef.current.currentTime = recoveryTime;
              pendingRecoveryTimeRef.current = null;
            }
            setMetadataLoaded(true);
          }}
          onLoadedData={() => {
            recoveryAttemptsRef.current = 0;
            updatePlayerReady(true);
          }}
          onCanPlay={() => {
            recoveryAttemptsRef.current = 0;
            updatePlayerReady(true);
            if (resumeAfterRecoveryRef.current) {
              resumeAfterRecoveryRef.current = false;
              void playerRef.current?.play().catch(() => {});
            }
          }}
          onPlaying={() => updatePlayerReady(true)}
          onLoadStart={() => {
            const player = playerRef.current;
            const readyState = getNativeVideo(player)?.readyState ?? player?.readyState ?? 0;
            if (readyState < 2) updatePlayerReady(false);
          }}
          onEmptied={() => {
            setMetadataLoaded(false);
            updatePlayerReady(false);
          }}
          playbackId={playbackId}
          autoPlay={autoplay || forceAutoplay}
          preload="auto"
          muted={isAutoplayMuted}
          playsInline
          accentColor={accentColor}
          volume={0.1}
          onTimeUpdate={handleTimeUpdate}
          ref={setPlayerRef as any}
          onPlay={handlePlay}
          onEnded={handleEnded}
          onPause={handlePause}
          style={{
            border: "none",
            opacity: isPlayerReady ? 1 : 0,
            transition: "opacity 0.2s ease",
            ...style,
          }}
        />
      )}
    </div>
  );
}
