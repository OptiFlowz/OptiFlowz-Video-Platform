import { memo, useState } from "react";
import { Link } from "react-router";
import { formatDate, formatDuration, formatViews } from "~/functions";
import type { SimilarVideoT } from "~/types";

function PlayCard({props, playedVideoId, playlistId, nextVideo} : {props: SimilarVideoT, playedVideoId: string, playlistId: string, nextVideo?: SimilarVideoT}){

    const newThumbnailUrl = props?.thumbnail_url
        ?.replace(/\.png(?=([?#]|$))/i, ".webp")
        ?.replace(/\.jpg(?=([?#]|$))/i, ".webp")
        .replace(/width=\d+/i, `width=${450}`)
        .replace(/height=\d+/i, `height=${250}`);
    let animGifUrl = `https://image.mux.com/` + props?.thumbnail_url.split('mux.com/')[1].split('/')[0] + "/animated.webp?width=300&fps=10&start=" + (props?.progress_seconds ? props.progress_seconds : 220);
    const isWatched = props?.percentage_watched < 5 ? false : props?.progress_seconds;

    const [isHovered, setIsHovered] = useState(false);

    const params = new URLSearchParams();
    if (playlistId) {
        params.set("p", playlistId);
    }
    const videoLink = `${props?.id}${params.toString() ? `?${params.toString()}` : ""}`;

    return (
        <Link to={`/video/${videoLink}`} className={`${props?.id == playedVideoId ? "active" : props?.id == nextVideo?.id ? "nextVideo" : ""} playCard flex gap-4 items-center rounded-xl transition-all hover:cursor-pointer`} onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}>
            <span className="banner relative w-[50%]">
                <img className={isHovered ? "z-[-1] absolute top-0 left-0" : "z-0 absolute top-0 left-0"} src={animGifUrl} alt="Thumbnail preview" />
                <img className={isHovered ? "z-0 relative opacity-0" : "z-1 relative opacity-100"} src={newThumbnailUrl} alt="Thumbnail" />

                <p className={"absolute bottom-1.75 right-1.75 z-2" + (isWatched ? " watched" : "")}>{formatDuration(props?.duration_seconds)}</p>

                {isWatched ? <span className="bottomShadow z-2"></span> : ""}

                {isWatched ? <span className="progressWrapper z-2">
                    <span style={{ width: `${(props?.progress_seconds / props?.duration_seconds) * 100}%` }}></span>
                </span> : ""}
            </span>

            <span className="info flex flex-col gap-1">
                <h2 title={props?.title}>{props?.title}</h2>

                <p className="author weakText">{props?.people.map(person => person.name).join(", ") || "Unknown author"}</p>
            
                <span className="flex items-center">
                    <p><b>{formatViews(props?.view_count)}</b></p>&nbsp;·&nbsp;<p className="weakText">{formatDate(props?.created_at)}</p>
                </span>
            </span>
        </Link>
    );
}

export default memo(PlayCard);