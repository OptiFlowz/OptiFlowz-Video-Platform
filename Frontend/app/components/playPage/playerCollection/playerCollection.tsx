import type { VideoT } from "~/types";
import { useCallback, useEffect, useMemo } from "react";
import { usePersistentVideo } from "~/components/persistentVideo/persistentVideoProvider";

function PlayerCollection({
  props,
  startTimeOverride,
  forceAutoplay = false,
}: {
  props?: VideoT & { class?: string };
  startTimeOverride?: number | null;
  forceAutoplay?: boolean;
}) {
  const streamUrl = props?.mux_playback_id;
  const { activate, setAnchor } = usePersistentVideo();

  const anchorRef = useCallback(
    (element: HTMLDivElement | null) => {
      setAnchor(element);
    },
    [setAnchor],
  );

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

  useEffect(() => {
    if (!props || !streamUrl) return;

    activate({
      video: props,
      startTimeOverride,
      forceAutoplay,
      returnHref: `${window.location.pathname}${window.location.search}`,
    });
  }, [activate, forceAutoplay, props, startTimeOverride, streamUrl]);

  return (
    <div ref={anchorRef} className={`player ${props?.class ?? ""}`}>
      <div className="persistent-video-slot" style={{ height: "100%" }} aria-hidden="true">
        <div className="player-skeleton">
          <div className="player-skeleton__controls">
            <span className="player-skeleton__chip player-skeleton__chip--wide"></span>
            <span className="player-skeleton__chip"></span>
            <span className="player-skeleton__chip player-skeleton__chip--short"></span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PlayerCollection;
