import { useEffect, useRef } from "react";
import MuxPlayer from "@mux/mux-player-react";
import type MuxPlayerElement from "@mux/mux-player";
import { useVideoPlayback } from "../playback/useVideoPlayback";
import { PlaybackFeedback } from "../playback/playbackFeedback";

// Seek the authorized video instead of modifying a signed thumbnail URL.
export function ThumbnailFramePreview({ videoId, time }: { videoId: string; time: number }) {
  const playback = useVideoPlayback(videoId);
  const player = useRef<MuxPlayerElement | null>(null);
  useEffect(() => {
    if (player.current) {
      player.current.pause();
      player.current.currentTime = time;
    }
  }, [time, playback.data?.stream_url]);

  if (!playback.data) return <PlaybackFeedback error={playback.isError} retry={() => void playback.refetch()} />;
  return (
    <MuxPlayer
      ref={player}
      src={playback.data.stream_url}
      muted
      playsInline
      autoPlay={false}
      onLoadedMetadata={() => { if (player.current) player.current.currentTime = time; }}
      className="thumbnailPickerImage"
      style={{ width: "100%", aspectRatio: "16 / 9", pointerEvents: "none", "--controls": "none" }}
    />
  );
}
