import { useQuery } from "@tanstack/react-query";
import { memo, useLayoutEffect, useRef, useState, useEffect, useCallback, useMemo } from "react";
import { AutoPlaySVG, BookmarkSVG, CloseSVG, ShareSVG } from "~/constants";
import { env } from "~/env";
import type { FetchPlaylistT, PlaylistVideosT } from "~/types";
import { fetchFn } from "~/API";
import PlaylistVideos from "./playlistVideos";
import { Link, useLocation } from "react-router";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";

function PlayingPlaylist({playlistId, videoId, onClose}: {playlistId: string, videoId: string, onClose: () => void}){
    const { t } = useI18n();
    const location = useLocation();

    const token = getToken() ?? "";
    const [isOpen, setIsOpen] = useState(false);
    const [isAutoPlayOn, setAutoPlay] = useState(() => {
        const v = localStorage.getItem("autoplay");
        return v === null ? true : v === "true";
    });
    const [isSaved, setIsSaved] = useState(false);
    const [saveCount, setSaveCount] = useState(0);
    const headerRef = useRef<HTMLDivElement>(null);

    function changeAutoPlay() {
        setAutoPlay(prev => {
            const next = !prev;
            localStorage.setItem("autoplay", String(next));
            return next;
        });
    }

    function useIsMobile(breakpoint = 500) {
        const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);

        useEffect(() => {
            const onResize = () => setIsMobile(window.innerWidth < breakpoint);
            window.addEventListener("resize", onResize);
            return () => window.removeEventListener("resize", onResize);
        }, [breakpoint]);

        return isMobile;
    }

    const isMobile = useIsMobile();

    useLayoutEffect(() => {
        const el = headerRef.current;
        if (!el) return;

        const update = () => {
            const h = el.offsetHeight;
            document.documentElement.style.setProperty("--headerHeight", `${h+10}px`);
        };

        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    const myHeaders = useMemo(() => {
        const headers = new Headers();
        if (token) {
            headers.set("Authorization", `Bearer ${token}`);
        }
        return headers;
    }, [token]);

    const {data: playlistResponse} = useQuery({
        queryKey: [`playlist${playlistId}`],
        queryFn: () => fetchFn<FetchPlaylistT>({
            route: `api/playlists/${playlistId}`,
            options: {
                method: "GET",
                headers: myHeaders
            }
        }),
        enabled: !!playlistId
    });

    const data = playlistResponse?.playlist;

    const {data: playlistVideosResponse} = useQuery({
        queryKey: [`playlist-videos${playlistId}`],
        queryFn: () => fetchFn<PlaylistVideosT>({
            route: `api/playlists/${playlistId}/videos?limit=100&page=1`,
            options: {
                method: "GET",
                headers: myHeaders
            }
        }),
        enabled: !!playlistId
    });

    const sharePlaylistLink = useCallback((e: React.MouseEvent<HTMLElement, MouseEvent>) => {
        e.preventDefault();
        const fullPath = env.siteUrl + location.pathname + location.search + location.hash;

        if(navigator.share)
            return navigator.share({
                title: t("playlistShareTitle"),
                text: t("playlistShareText"),
                url: fullPath
            });

        if(navigator.clipboard && window.isSecureContext)
            return navigator.clipboard.writeText(fullPath);
    }, [location.pathname, location.search, location.hash, t]);

    useLayoutEffect(() => {
        if (data) {
            setIsSaved(!!data.is_saved);
            setSaveCount(data.save_count ?? 0);
        }
    }, [data?.is_saved, data?.save_count]);

    useEffect(() => {
        const frame = requestAnimationFrame(() => setIsOpen(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    const toggleSave = async () => {
        if (!data?.id || !token) return;

        const prevSaved = isSaved;
        const prevCount = saveCount;

        const optimisticNext = !prevSaved;
        setIsSaved(optimisticNext);
        setSaveCount((c) => c + (optimisticNext ? 1 : -1));

        try {
            const myHeaders = new Headers();
            myHeaders.set("Authorization", `Bearer ${token}`);
            myHeaders.set("Content-Type", "application/json");

            const response = await fetch(
                `${env.apiBaseUrl}/api/playlists/${data.id}/save`,
                { method: "POST", headers: myHeaders, redirect: "follow" }
            );

            const result = await response.json();

            if (typeof result?.is_saved === "boolean") setIsSaved(result.is_saved);
            if (typeof result?.save_count === "number") setSaveCount(result.save_count);

        } catch {
            setIsSaved(prevSaved);
            setSaveCount(prevCount);
        }
    };

    const handleClose = () => {
        if (!isMobile) {
            onClose();
            return;
        }

        setIsOpen(false);
        window.setTimeout(() => onClose(), 320);
    };

    return (
        <div className={`sidePlaylists ${isOpen ? "" : "closed"}`}>
            <div ref={headerRef} className="playlistHeader">
                <span className="titleBar">
                    <Link to={`/playlist/${playlistId}`}>
                        <h2>{data?.title}</h2>
                        <p>
                            {t("playlistLabel")} · {t("videosLabel", { count: data?.video_count || 0 })} · {t("saveCountLabel", { count: saveCount })}
                        </p>
                    </Link>
                    <button onClick={handleClose} aria-label={t("close")}>{CloseSVG}</button>
                </span>
                <span className="tagsHolder">
                    <span className="tags">
                        <button className="whiteTag" onClick={changeAutoPlay} title={t("toggleAutoplay")}>{AutoPlaySVG}&nbsp;{isAutoPlayOn ? t("on") : t("off")}</button>
                        <button className={`${isSaved ? "saved" : ""} clickable`} onClick={toggleSave}>{BookmarkSVG}&nbsp;{isSaved ? t("saved") : t("save")}</button>
                        <button onClick={e => sharePlaylistLink(e)} title={t("sharePlaylist")}>{ShareSVG}&nbsp;{t("share")}</button>
                    </span>
                </span>
            </div>
            <PlaylistVideos playlistId={playlistId} videos={playlistVideosResponse?.videos ?? []} playedVideoId={videoId} />
        </div>
    );
}

export default memo(PlayingPlaylist);
