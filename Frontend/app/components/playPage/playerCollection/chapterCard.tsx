// chapterCard.tsx
import { memo, useMemo } from "react";
import { formatDuration } from "~/functions";
import type { ChapterT } from "~/types";

function ChapterCard({
  props,
  thumbnail_url,
  index,
  nextStartTime,
  playerTime,
}: {
  props: ChapterT;
  thumbnail_url: string;
  index: number;
  nextStartTime: number;
  playerTime: number;
}) {
  const start = Number(
    props?.startTime ?? (props as any)?.start_time ?? (props as any)?.time ?? 0
  );

  const isActive = useMemo(() => {
    const end = Number.isFinite(nextStartTime) ? nextStartTime : Number.POSITIVE_INFINITY;
    return playerTime >= start && playerTime < end;
  }, [playerTime, start, nextStartTime]);

  const rightThumbnailUrl = useMemo(() => {
    const base = (thumbnail_url ?? "").split("?")[0];
    if (index === 0) return thumbnail_url;
    return `${base}?time=${start}&width=320&height=180`;
  }, [thumbnail_url, index, start]);

  function setPlayerTime() {
    window.dispatchEvent(new CustomEvent("player:seek", { detail: { seconds: start } }));
  }

  return (
    <div
      className={`playCard chapterCard flex gap-4 items-start rounded-xl transition-all hover:cursor-pointer ${
        isActive ? "active" : ""
      }`}
      onClick={setPlayerTime}
      role="button"
      tabIndex={0}
    >
      <span className="banner relative w-[50%]">
        <img className="z-1 relative opacity-100" src={rightThumbnailUrl} alt="Thumbnail" />
      </span>

      <span className="info flex flex-col gap-1">
        <h2 title={props?.title}>{props?.title}</h2>
        <p className="chapterStartTime">{formatDuration(start)}</p>
      </span>
    </div>
  );
}

export default memo(ChapterCard);
