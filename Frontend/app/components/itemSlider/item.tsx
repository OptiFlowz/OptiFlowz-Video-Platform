import { Link } from "react-router";
import { useContext, useState } from "react";
import ContentInfo from "~/components/contentInfo";
import { formatDuration } from "~/functions";
import type { VideoT } from "~/types";
import { CurrentNavContext } from "~/context";

function  Item({props, playlistIndex, playlistId}: {props: VideoT, playlistIndex?: number, playlistId?: string}){
    const isBigWindow = typeof window !== 'undefined' && (window.innerWidth > 1500 || (window.innerWidth > 670 && window.innerWidth < 800));
    const newThumbnailUrl = props?.thumbnail_url
        ?.replace(/\.png(?=([?#]|$))/i, ".webp")
        ?.replace(/\.jpg(?=([?#]|$))/i, ".webp")
        ?.replace(/width=\d+/i, `width=${isBigWindow ? 700 : 500}`)
        ?.replace(/height=\d+/i, `height=${isBigWindow ? 525 : 375}`);
    const animGifUrl = `https://image.mux.com/` + props?.thumbnail_url?.split('mux.com/')[1]?.split('/')[0] + `/animated.webp?width=640&fps=10&start=` + (props.progress_seconds ? props.progress_seconds : 220);
    const isWatched = (props?.percentage_watched ?? 0) >= 5 && !!props?.progress_seconds;

    const [isHovered, setIsHovered] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isPreviewLoading, setIsPreviewLoading] = useState(true);

    const {setCurrentNav} = useContext(CurrentNavContext);

    return (
        <Link 
            className={`item ${playlistIndex == 1 ? "playlistStartVideo" : ""}`} 
            to={`/video/${props?.id || 0}${playlistId ? ("?p="+playlistId) : ""}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={() => setCurrentNav(-1)}
        >
            <span className={`${isLoading ? "opacity-0 absolute!" : "relative"}`}>
                {!isLoading && 
                    <img
                        className={isHovered ? "z-[-1] absolute top-0 left-0" : "z-[-1] absolute top-0 left-0 opacity-0"}
                        src={animGifUrl}
                        alt="Thumbnail preview"
                        decoding="async"
                        onLoad={() => setIsPreviewLoading(false)}
                    />
                }
                <img 
                    className={`thumbnail ${isLoading ? "z-0 absolute opacity-0" : `relative ${!isPreviewLoading && isHovered ? "z-0 opacity-0 transition-opacity! duration-200! ease" : isHovered ? "z-1 opacity-100 darken" : "z-1 -100"}`}`}
                    src={newThumbnailUrl}
                    alt="Thumbnail"
                    decoding="async"
                    onLoad={() => setIsLoading(false)}
                />

                {playlistIndex && playlistIndex > -1 ? <span className="playlistOrderNumber">{playlistIndex}</span> : ""}

                <span className={"duration z-1" + (isWatched ? " watched" : "")}>{formatDuration(props.duration_seconds)}</span>

                {isWatched ? <span className="bottomShadow z-1 relative"></span> : ""}

                {isWatched ? <span className="progressWrapper z-2 relative">
                    <span style={{ width: `${(props?.progress_seconds / props?.duration_seconds) * 100}%` }}></span>
                </span> : ""}
            </span>

            {isLoading && 
                <div className="skeleton-item">
                    <div className="skeleton-thumbnail"></div>
                    <div className="skeleton-content">
                        <div className="skeleton-title"></div>
                        <div className="skeleton-text"></div>
                        <div className="skeleton-text short"></div>
                    </div>
                </div>
            }

            <ContentInfo props={{
                title: props?.title,
                author: props?.people?.map(person => person.name).join(", "),
                views: props?.view_count,
                date: props?.created_at
            }} />
        </Link>
    );
}

export default Item;
