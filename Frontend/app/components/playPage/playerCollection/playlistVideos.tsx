import { memo, useMemo, useLayoutEffect, useRef } from "react";
import PlayCard from "./playCard";
import type { PlaylistVideoT } from "~/types";

function PlaylistVideos({ playlistId, videos, playedVideoId }: { playlistId: string; videos: PlaylistVideoT[]; playedVideoId: string }) {
  const holderRef = useRef<HTMLDivElement>(null);

  const { currentIndex, nextVideo } = useMemo(() => {
    const idx = videos.findIndex((v) => v.id === playedVideoId);
    const next = idx >= 0 && idx + 1 < videos.length ? videos[idx + 1] : null;
    return { currentIndex: idx, nextVideo: next };
  }, [videos, playedVideoId]);

  const similarArray = videos.map((item, index) => (
    <PlayCard
      key={`similar${index}`}
      props={item}
      playedVideoId={playedVideoId}
      playlistId={playlistId}
      nextVideo={nextVideo as PlaylistVideoT}
    />
  ));

  useLayoutEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;

    const activeEl = holder.querySelector(".active") as HTMLElement | null;
    if (!activeEl) return;

    const top = activeEl.offsetTop;

    holder.scrollTo({
      top: top - 35 - activeEl.offsetHeight,
      behavior: "smooth",
    });
  }, [playedVideoId, currentIndex, videos.length]);

  return (
    <div className="similar" ref={holderRef}>
      <div className="holder">
        {similarArray}
      </div>
    </div>
  );
}

export default memo(PlaylistVideos);
