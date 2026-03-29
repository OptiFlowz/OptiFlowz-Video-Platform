import { useContext, useState } from "react";
import { Link } from "react-router";
import { CurrentNavContext } from "~/context";
import type { VideoPlaylistT } from "~/types";
import PlaylistInfo from "../playlistInfo";
import { LibrarySVG } from "~/constants";
import { useI18n } from "~/i18n";

function PlaylistItem({props, featured}: {props: VideoPlaylistT, featured?:boolean}){
    const { t } = useI18n();
    const newThumbnailUrl = props?.thumbnail_url.replace(/width=\d+/i, `width=${800}`).replace(/height=\d+/i, `height=${600}`);
    const [isLoading, setIsLoading] = useState(true);

    const {setCurrentNav} = useContext(CurrentNavContext);

    const playlistLink = featured ? `/playlist/${props.id || 0}` : `?p=${props.id || 0}`;

    return (
        <Link 
            className={`item playlistItem ${featured ? "featured" : ""}`}
            to={playlistLink}
            preventScrollReset={!featured}
            onClick={() => setCurrentNav(-1)}
        >
            {isLoading && 
                <div className="skeleton-item">
                    <div className="skeleton-thumbnail"></div>
                        <div className="skeleton-content">
                        <div className="skeleton-title"></div>
                        <div className="skeleton-text short"></div>
                    </div>
                </div>
            }

            <span className={`${isLoading ? "absolute opacity-0" : "relative"}`}>
                <img
                    className={"z-0 relative opacity-100"}
                    src={newThumbnailUrl}
                    alt="Thumbnail"
                    loading="lazy"
                    decoding="async"
                    onLoad={() => setIsLoading(false)}
                />

                <span className={`pins absolute ${featured ? "bottom-3 right-3 gap-1.75" : "bottom-1.75 right-1.75 gap-1.5"} flex items-center`}>
                    <p className="flex items-center max-[450px]:hidden">{LibrarySVG}&nbsp;{t("playlistLabel")}</p>

                    <p>{t("videosLabel", { count: props.video_count })}</p>
                </span>
            </span>

            {(!isLoading) && <PlaylistInfo props={{
                title: props.title,
                views: props.view_count,
                date: props.created_at
            }} />}
        </Link>
    );
}

export default PlaylistItem;
