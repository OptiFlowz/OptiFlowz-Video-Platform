import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import MuxPlayer from "@mux/mux-player-react";
import type MuxPlayerElement from "@mux/mux-player";
import { useI18n } from "~/i18n";
import { useVideoPlayback } from "../playback/useVideoPlayback";
import { PlaybackFeedback } from "../playback/playbackFeedback";
import { loadMediaTheme, styleMuxPlayerCaptions } from "../playPage/playerCollection/loadMediaTheme";

interface VideoPreviewProps {
  isVideoLoading: boolean;
  videoData: { id: string; duration_seconds: number } | null | undefined;
  title: string;
  chapters: { timestamp: string; title: string }[];
  revision: number;
}

// Refresh only playback credentials: refetching the editor's video query would
// repopulate the form and discard unsaved changes in other sections.
export function useVideoPreviewRefresh(videoId: string | null) {
  const queryClient = useQueryClient();
  const [previewRevision, setPreviewRevision] = useState(0);
  const refreshVideoPreview = useCallback(async () => {
    if (!videoId) return;
    await queryClient.invalidateQueries({ queryKey: ["video-playback", videoId] });
    // Public playback URLs can stay identical, so explicitly recreate the player
    // to reload the HLS manifest and its subtitle tracks after every saved change.
    setPreviewRevision((revision) => revision + 1);
  }, [queryClient, videoId]);
  return { previewRevision, refreshVideoPreview };
}

function formatSecondsToTimestamp(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function parseTimestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

export const VideoEditorPreview = ({
  isVideoLoading,
  videoData,
  title,
  chapters,
  revision,
}: VideoPreviewProps) => {
  const { t } = useI18n();
  const playback = useVideoPlayback(videoData?.id, !isVideoLoading && !!videoData);
  const [isThemeReady, setIsThemeReady] = useState(false);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const playerRef = useRef<MuxPlayerElement | null>(null);
  const position = useRef(0);

  useEffect(() => {
    setMetadataLoaded(false);
  }, [playback.data?.mux_playback_id, revision]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !metadataLoaded) return;

    const muxChapters = (chapters ?? [])
      .map((chapter) => ({
        startTime: parseTimestampToSeconds(chapter.timestamp),
        value: String(chapter.title ?? ""),
      }))
      .filter((chapter) => Number.isFinite(chapter.startTime) && chapter.value.length > 0);

    if (!muxChapters.length) return;

    try {
      player.addChapters(muxChapters);
    } catch {
      // ignore preview chapter registration errors
    }
  }, [chapters, metadataLoaded]);

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

  if (isVideoLoading) {
    return (
      <div className="videoPreviewContainer">
        <div className="videoPreviewLoading">
          <div className="uploadSpinner" />
          <p>{t("loadingVideoPreview")}</p>
        </div>
      </div>
    );
  }

  if (!playback.data) {
    return <div className="videoPreviewContainer"><PlaybackFeedback error={playback.isError} retry={() => void playback.refetch()} /></div>;
  }

  return (
    <div className="videoPreviewContainer">
      <div className="videoPreviewWrapper">
        {isThemeReady ? (
          <MuxPlayer
            key={`${videoData?.id}:${revision}`}
            startTime={position.current}
            onTimeUpdate={() => {
              if (playerRef.current) position.current = playerRef.current.currentTime;
            }}
            theme="optiflowz-theme"
            themeProps={{ videotitlee: title, chapterLenght: chapters?.length || 0 }}
            src={playback.data.stream_url}
            autoPlay={false}
            playsInline
            volume={0.1}
            ref={playerRef}
            onLoadedMetadata={(event) => {
              styleMuxPlayerCaptions(event.currentTarget as MuxPlayerElement);
              setMetadataLoaded(true);
            }}
            style={{
              width: "100%",
              aspectRatio: "16 / 9",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          />
        ) : (
          <div className="videoPreviewLoading">
            <div className="uploadSpinner" />
            <p>{t("loadingVideoPreview")}</p>
          </div>
        )}
      </div>
      <div className="videoPreviewInfo">
        <h3 className="videoPreviewTitle">{title || "Untitled Video"}</h3>
        {videoData?.duration_seconds && (
          <p className="videoPreviewDuration">
            Duration: {formatSecondsToTimestamp(videoData?.duration_seconds)}
          </p>
        )}
      </div>
    </div>
  );
};
