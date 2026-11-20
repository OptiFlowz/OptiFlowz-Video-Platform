import { useI18n } from "~/i18n";
import LiveStatus from '../live/LiveStatus';
import DefaultThumbnail from "../../../assets/DefaultThumbnail.webp";
import { getVideoThumbnail } from "~/components/shared/videoMedia";
import { isRoleLocked } from "~/authorization/videoAudience";
import { VideoCardLink } from "~/components/shared/videoCardLink";
import { VideoLockOverlay } from "~/components/shared/videoLockOverlay";
import { useContext, useState } from "react";
import ContentInfo from "~/components/contentInfo";
import { formatDuration } from "~/functions";
import type { PlaylistVideoT } from "~/types";
import { CurrentNavContext } from "~/context";
import { useDelayedHoverPreview } from "~/components/shared/useDelayedHoverPreview";

function Item({props, playlistIndex, playlistId, href, live}: {props: Omit<PlaylistVideoT, "people"> & { people: { name: string }[] }, playlistIndex?: number, playlistId?: string, href?: string, live?: { status: import("../live/api").LiveStatus; scheduled_at?: string | null }}){
    const { t } = useI18n();
    const requestedThumbnail = getVideoThumbnail(props) || DefaultThumbnail;
    const [failedThumbnail, setFailedThumbnail] = useState<string>();
    const newThumbnailUrl = failedThumbnail === requestedThumbnail ? DefaultThumbnail : requestedThumbnail;
    const isLive = !!live;
    const locked = isRoleLocked(props);
    const animGifUrl = !locked && !isLive ? props.preview_url || undefined : undefined;
    const isWatched = (!isLive) && (props?.percentage_watched ?? 0) >= 5 && !!props?.progress_seconds;

    const [isHovered, setIsHovered] = useState(false);
    const { isActive: previewActive, requested: previewRequested, start: startPreview, cancel: cancelPreview } = useDelayedHoverPreview();
    const [loadedThumbnail, setLoadedThumbnail] = useState<string>();
    const isLoading = loadedThumbnail !== newThumbnailUrl;
    const [loadedPreview, setLoadedPreview] = useState<string>();

    const {setCurrentNav} = useContext(CurrentNavContext);
    const params = new URLSearchParams();
    if (playlistId) {
        params.set("p", playlistId);
    }
    const videoHref = `/video/${props?.id || 0}${params.toString() ? `?${params.toString()}` : ""}`;

    return (
        <VideoCardLink locked={locked}
            className={`item ${playlistId ? "playlistVideo" : ""}`}
            to={href || videoHref}
            onMouseEnter={() => { setIsHovered(true); startPreview(); }}
            onFocus={() => { setIsHovered(true); startPreview(); }}
            onBlur={() => { setIsHovered(false); cancelPreview(); }}
            onMouseLeave={() => { setIsHovered(false); cancelPreview(); }}
            onClick={() => setCurrentNav(-1)}
        >
            <span className="itemThumbnail" data-locked-banner={locked || undefined}>
                {locked && <VideoLockOverlay />}
                {isLoading && <span className="itemThumbnailSkeleton skeleton-thumbnail" aria-hidden="true" />}
                {previewRequested && animGifUrl &&
                    <img
                        className={previewActive ? "z-[-1] absolute top-0 left-0" : "z-[-1] absolute top-0 left-0 opacity-0"}
                        src={animGifUrl}
                        alt={t("thumbnailPreview")}
                        loading="eager"
                        decoding="async"
                        onLoad={() => setLoadedPreview(animGifUrl)}
                        onError={() => setLoadedPreview(undefined)}
                    />
                }
                <img
                    className={`thumbnail ${isLoading ? "z-0 relative opacity-0" : `relative ${animGifUrl && loadedPreview === animGifUrl && previewActive ? "z-0 opacity-0 transition-opacity! duration-200! ease" : isHovered ? "z-1 opacity-100 darken" : "z-1 -100"}`}`}
                    src={newThumbnailUrl}
                    alt={t("thumbnail")}
                    loading="lazy"
                    decoding="async"
                    ref={image => { if (image?.complete && image.naturalWidth > 0) setLoadedThumbnail(newThumbnailUrl); }}
                    onLoad={() => setLoadedThumbnail(newThumbnailUrl)}
                    onError={() => { setFailedThumbnail(requestedThumbnail); setLoadedThumbnail(newThumbnailUrl); }}
                />

                {playlistIndex && playlistIndex > -1 ? <span className="playlistOrderNumber">{playlistIndex}</span> : ""}

                <span className="liveCardBadge"><LiveStatus live={live} scheduledAt={live?.scheduled_at} /></span>
                {!isLive && !locked && <span className={"duration z-1" + (isWatched ? " watched" : "")}>{formatDuration(props.duration_seconds)}</span>}

                {isWatched ? <span className="bottomShadow z-1 relative"></span> : ""}

                {isWatched ? <span className="progressWrapper z-2 relative">
                    <span style={{ width: `${(props?.progress_seconds / props?.duration_seconds) * 100}%` }}></span>
                </span> : ""}
            </span>

            <ContentInfo props={{
                title: props?.title,
                author: props?.people?.map(person => person.name).join(", ") || props?.uploader_name,
                views: live ? undefined : props?.view_count,
                date: props?.created_at,
                uploader_name: props?.uploader_name,
            }} />
        </VideoCardLink>
    );
}

export default Item;
