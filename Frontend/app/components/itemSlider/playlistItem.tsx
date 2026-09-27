import DefaultThumbnail from "../../../assets/DefaultThumbnail.webp";
import { useContext, useState } from "react";
import { Link } from "react-router";
import { CurrentNavContext } from "~/context";
import type { VideoPlaylistT } from "~/types";
import PlaylistInfo from "../playlistInfo";
import { LibrarySVG, LockSVG } from "~/constants";
import { useI18n } from "~/i18n";

function PlaylistItem({props, featured}: {props: VideoPlaylistT, featured?:boolean}){
    const { t } = useI18n();
    const requestedThumbnail = props?.thumbnail_url || DefaultThumbnail;
    const [failedThumbnail, setFailedThumbnail] = useState<string>();
    const newThumbnailUrl = failedThumbnail === requestedThumbnail ? DefaultThumbnail : requestedThumbnail;
    const [loadedThumbnail, setLoadedThumbnail] = useState<string>();
    const isLoading = loadedThumbnail !== newThumbnailUrl;

    const {setCurrentNav} = useContext(CurrentNavContext);

    const playlistLink = featured ? `/playlist/${props.id || 0}` : `?p=${props.id || 0}`;

    return (
        <Link 
            className={`item playlistItem ${featured ? "featured" : ""}`}
            to={playlistLink}
            preventScrollReset={!featured}
            onClick={() => setCurrentNav(-1)}
        >
            <span className="itemThumbnail">
                {isLoading && <span className="itemThumbnailSkeleton skeleton-thumbnail" aria-hidden="true" />}
                <img
                    className={`z-0 relative ${isLoading ? "opacity-0" : "opacity-100"}`}
                    src={newThumbnailUrl}
                    alt="Thumbnail"
                    loading="lazy"
                    decoding="async"
                    ref={image => { if (image?.complete && image.naturalWidth > 0) setLoadedThumbnail(newThumbnailUrl); }}
                    onLoad={() => setLoadedThumbnail(newThumbnailUrl)}
                    onError={() => { setFailedThumbnail(requestedThumbnail); setLoadedThumbnail(newThumbnailUrl); }}
                />

                <span className={`pins absolute ${featured ? "bottom-3 right-3 gap-1.75" : "bottom-1.75 right-1.75 gap-1.5"} flex items-center`}>
                    <p className="flex items-center max-[450px]:hidden">{LibrarySVG}&nbsp;{t("playlistLabel")}</p>

                    <p>{t("videosLabel", { count: props.video_count })}</p>
                    {props.status === "private" && (
                        <p aria-label={t("adminPrivate")} title={t("adminPrivate")} className="flex items-center gap-1.5">
                            {LockSVG}
                            <span>{t("adminPrivate")}</span>
                        </p>
                    )}
                </span>
            </span>

            <PlaylistInfo props={{
                title: props.title,
                views: props.view_count,
                date: props.created_at
            }} />
        </Link>
    );
}

export default PlaylistItem;
