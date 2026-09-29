import { memo, useState } from "react";
import type { VPreviewProps } from "~/types";
import ContentInfo from "~/components/contentInfo";
import { Link } from "react-router";
import { formatDuration } from "~/functions";
import { useDelayedHoverPreview } from "~/components/shared/useDelayedHoverPreview";

function Item({props}: {props: VPreviewProps}){
    const {id, duration, ...info} = props;

    const newThumbnailUrl = props.thumbnail;
    const animGifUrl = props.preview_url || undefined;
    const isWatched = (props?.percentage_watched < 5 || props?.percentage_watched > 95) ? false : props?.progress_seconds;

    const { isActive: previewActive, start: startPreview, cancel: cancelPreview } = useDelayedHoverPreview();
    const [loadedPreview, setLoadedPreview] = useState<string>();
    const showPreview = previewActive && !!animGifUrl && loadedPreview === animGifUrl;

    return (
        <Link to={`/video/${id || 0}`} className="item" onMouseEnter={startPreview} onFocus={startPreview} onBlur={cancelPreview} onMouseLeave={cancelPreview}>
            <div className="thumbnail">
                {animGifUrl && <img className={previewActive ? "z-[-1] absolute top-0 left-0" : "z-0 absolute top-0 left-0 opacity-0"} src={animGifUrl} alt="Thumbnail preview" loading="eager" decoding="async" onLoad={() => setLoadedPreview(animGifUrl)} onError={() => setLoadedPreview(undefined)} />}
                <img className={showPreview ? "z-0 relative opacity-0" : "z-1 relative opacity-100"} src={newThumbnailUrl} alt="Thumbnail" loading="lazy" decoding="async" />
                <span className={"duration z-1" + (isWatched ? " watched" : "")}>{formatDuration(Number(duration))}</span>
                
                {isWatched ? <span className="bottomShadow z-1 relative"></span> : ""}

                {isWatched ? <span className="progressWrapper z-2 relative">
                    <span style={{ width: `${(props?.progress_seconds / props?.duration_seconds) * 100}%` }}></span>
                </span> : ""}
            </div>

            <span>
                <ContentInfo props={{ ...info, views: Number((info as any).views) }} />
            </span>
        </Link>
    )
}

export default memo(Item);
