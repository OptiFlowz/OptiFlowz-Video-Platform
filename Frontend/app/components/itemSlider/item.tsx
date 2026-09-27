import DefaultThumbnail from "../../../assets/DefaultThumbnail.webp";
import { getVideoThumbnail } from "~/components/shared/videoMedia";
import { Link } from "react-router";
import { useContext, useState } from "react";
import ContentInfo from "~/components/contentInfo";
import { formatDuration } from "~/functions";
import type { PlaylistVideoT } from "~/types";
import { CurrentNavContext } from "~/context";

function  Item({props, playlistIndex, playlistId}: {props: PlaylistVideoT, playlistIndex?: number, playlistId?: string}){
    const requestedThumbnail = getVideoThumbnail(props) || DefaultThumbnail;
    const [failedThumbnail, setFailedThumbnail] = useState<string>();
    const newThumbnailUrl = failedThumbnail === requestedThumbnail ? DefaultThumbnail : requestedThumbnail;
    const animGifUrl = props.preview_url || undefined;
    const isWatched = (props?.percentage_watched ?? 0) >= 5 && !!props?.progress_seconds;

    const [isHovered, setIsHovered] = useState(false);
    const [loadedThumbnail, setLoadedThumbnail] = useState<string>();
    const isLoading = loadedThumbnail !== newThumbnailUrl;
    const [previewRequested, setPreviewRequested] = useState(false);
    const [loadedPreview, setLoadedPreview] = useState<string>();

    const {setCurrentNav} = useContext(CurrentNavContext);
    const params = new URLSearchParams();
    if (playlistId) {
        params.set("p", playlistId);
    }
    const videoHref = `/video/${props?.id || 0}${params.toString() ? `?${params.toString()}` : ""}`;

    return (
        <Link
            className={`item ${playlistIndex == 1 ? "playlistStartVideo" : ""}`}
            to={videoHref}
            onMouseEnter={() => { setIsHovered(true); setPreviewRequested(true); }}
            onFocus={() => { setIsHovered(true); setPreviewRequested(true); }}
            onBlur={() => setIsHovered(false)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={() => setCurrentNav(-1)}
        >
            <span className="itemThumbnail">
                {isLoading && <span className="itemThumbnailSkeleton skeleton-thumbnail" aria-hidden="true" />}
                {!isLoading && previewRequested && animGifUrl &&
                    <img
                        className={isHovered ? "z-[-1] absolute top-0 left-0" : "z-[-1] absolute top-0 left-0 opacity-0"}
                        src={animGifUrl}
                        alt="Thumbnail preview"
                        decoding="async"
                        onLoad={() => setLoadedPreview(animGifUrl)}
                        onError={() => setLoadedPreview(undefined)}
                    />
                }
                <img
                    className={`thumbnail ${isLoading ? "z-0 relative opacity-0" : `relative ${animGifUrl && loadedPreview === animGifUrl && isHovered ? "z-0 opacity-0 transition-opacity! duration-200! ease" : isHovered ? "z-1 opacity-100 darken" : "z-1 -100"}`}`}
                    src={newThumbnailUrl}
                    alt="Thumbnail"
                    loading="lazy"
                    decoding="async"
                    ref={image => { if (image?.complete && image.naturalWidth > 0) setLoadedThumbnail(newThumbnailUrl); }}
                    onLoad={() => setLoadedThumbnail(newThumbnailUrl)}
                    onError={() => { setFailedThumbnail(requestedThumbnail); setLoadedThumbnail(newThumbnailUrl); }}
                />

                {playlistIndex && playlistIndex > -1 ? <span className="playlistOrderNumber">{playlistIndex}</span> : ""}

                <span className={"duration z-1" + (isWatched ? " watched" : "")}>{formatDuration(props.duration_seconds)}</span>

                {isWatched ? <span className="bottomShadow z-1 relative"></span> : ""}

                {isWatched ? <span className="progressWrapper z-2 relative">
                    <span style={{ width: `${(props?.progress_seconds / props?.duration_seconds) * 100}%` }}></span>
                </span> : ""}
            </span>

            <ContentInfo props={{
                title: props?.title,
                author: props?.people?.map(person => person.name).join(", ") || props?.uploader_name,
                views: props?.view_count,
                date: props?.created_at,
                uploader_name: props?.uploader_name,
            }} />
        </Link>
    );
}

export default Item;
