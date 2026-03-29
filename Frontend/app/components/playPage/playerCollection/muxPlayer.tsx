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
import type { ChapterT } from "~/types";
import { getToken } from "~/functions";
import { loadMediaTheme } from "./loadMediaTheme";

interface VideoPlayerProps {
  playbackId: string;
  videoId: string;
  videoTitle: string;
  apiBaseUrl?: string;
  autoplay?: boolean;
  accentColor?: string;
  currentTimee?: number;
  style?: React.CSSProperties;
  view_id: string;
  last_seq: number;
  chapters: ChapterT[];
  onProgressSaved?: (seconds: number) => void;
}

const EMPTY_STYLE: React.CSSProperties = {};

export default function VideoPlayer({
  playbackId,
  videoId,
  videoTitle,
  apiBaseUrl = import.meta.env.VITE_FIRST,
  autoplay = true,
  accentColor = "#ec8b55",
  style = EMPTY_STYLE,
  currentTimee,
  view_id,
  last_seq,
  chapters,
  onProgressSaved,
}: VideoPlayerProps) {
  const playerRef = useRef<MuxPlayerElement | null>(null);

  // ---------------------------
  // METADATA / INITIAL SEEK
  // ---------------------------
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isThemeReady, setIsThemeReady] = useState(false);
  const didInitialSeek = useRef(false);

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
    setMetadataLoaded(false);
    setIsPlayerReady(false);
    didInitialSeek.current = false;
  }, [playbackId]);

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
  const hbSeqRef = useRef<number>(0);

  // cache token
  const hbTokenRef = useRef<string | null>(null);
  useEffect(() => {
    hbTokenRef.current = getToken() ?? null;
  }, []);

  // sync sa server last_seq ali samo kao MAX (nikad unazad)
  useEffect(() => {
    hbSeqRef.current = last_seq;
  }, [last_seq]);

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
      if (!token) return;
      hbTokenRef.current = token;

      const nextSeq = (hbSeqRef.current || 0) + 1;
      hbSeqRef.current = nextSeq;

      const payload = { view_id, seq: nextSeq, is_playing: isPlaying };

      try {
        await fetch(`${apiBaseUrl}/api/videos/heartbeat`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
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
      stopHeartbeat();
      hbIsPlayingRef.current = false;
      void sendHeartbeat(false, true); // force jednom na izlazu
    };
  }, [sendHeartbeat, stopHeartbeat]);

  function playNextVideoIfAutoPlayOn() {
    const autoLocal = localStorage.getItem("autoplay");
    const autoplayEnabled = autoLocal !== "false";
    if (!autoplayEnabled) return;

    document.querySelector<HTMLAnchorElement>(".nextVideo")?.click();
  }

  const handlePlay = useCallback(() => {
    hbIsPlayingRef.current = true;
    void sendHeartbeat(true, true); // force odmah
    startHeartbeat();               // interval radi samo u play-u
  }, [sendHeartbeat, startHeartbeat]);

  const handlePause = useCallback(() => {
    hbIsPlayingRef.current = false;
    stopHeartbeat();                // PREKINI interval da ne šalje false non-stop
    void sendHeartbeat(false, true); // pošalji false samo jednom
  }, [sendHeartbeat, stopHeartbeat]);

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
          }}
          onLoadedMetadata={() => {
            setMetadataLoaded(true);
            setIsPlayerReady(true);
          }}
          playbackId={playbackId}
          autoPlay={autoplay}
          playsInline
          accentColor={accentColor}
          volume={0.1}
          onTimeUpdate={handleTimeUpdate}
          ref={playerRef as any}
          onPlay={handlePlay}
          onEnded={playNextVideoIfAutoPlayOn}
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
