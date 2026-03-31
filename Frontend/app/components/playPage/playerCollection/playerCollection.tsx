import type { VideoT } from "~/types";
import { useEffect, useMemo } from "react";
import VideoPlayer from "./muxPlayer";

function PlayerCollection({
  props,
  startTimeOverride,
}: {
  props?: VideoT & { class?: string };
  startTimeOverride?: number | null;
}) {
  const streamUrl = props?.mux_playback_id;

  const speakers = useMemo(() => {
    // Pokušaj iz people (najčešće speaker-i)
    const names =
      props?.people?.map((p: any) => p?.name).filter(Boolean) ?? [];

    const uniq = Array.from(new Set(names));

    if (uniq.length > 0) return uniq.join(", ");
    if (props?.uploader_name) return props.uploader_name;

    return ""; // može i "EAES" ako želiš
  }, [props?.people, props?.uploader_name]);

  const artworkUrl = props?.thumbnail_url || "";

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    // Neki browseri bacaju ako MediaMetadata nije definisan
    try {
      // @ts-ignore
      navigator.mediaSession.metadata = new MediaMetadata({
        title: props?.title || "",
        artist: speakers, // ovde idu speaker-i (ili uploader)
        album: "OptiFlowz Video Platform",
        artwork: artworkUrl
          ? [
              { src: artworkUrl, sizes: "96x96", type: "image/jpeg" },
              { src: artworkUrl, sizes: "128x128", type: "image/jpeg" },
              { src: artworkUrl, sizes: "192x192", type: "image/jpeg" },
              { src: artworkUrl, sizes: "256x256", type: "image/jpeg" },
              { src: artworkUrl, sizes: "384x384", type: "image/jpeg" },
              { src: artworkUrl, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
    } catch {
      // ignore
    }
  }, [props?.title, speakers, artworkUrl]);

  return (
    <div className={`player ${props?.class ?? ""}`}>
      {!streamUrl ? (
        <div id="playerCanvas" style={{ height: "100%" }}>
          <div className="player-skeleton" aria-hidden="true">
            <div className="player-skeleton__controls">
              <span className="player-skeleton__chip player-skeleton__chip--wide"></span>
              <span className="player-skeleton__chip"></span>
              <span className="player-skeleton__chip player-skeleton__chip--short"></span>
            </div>
          </div>
        </div>
      ) : (
      <VideoPlayer
        playbackId={streamUrl}
        currentTimee={
          startTimeOverride != null
            ? startTimeOverride
            : props?.percentage_watched < 95
              ? props?.progress_seconds
              : 0
        }
        videoId={props?.id}
        videoTitle={props?.title}
        view_id={props?.view?.view_id}
        last_seq={props?.view?.last_seq}
        chapters={props?.chapters}
      />
      )}
    </div>
  );
}

export default PlayerCollection;
