import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
import { AutoPlaySVG, BookmarkSVG, CloseSVG, ShareSVG } from "~/constants";
import { env } from "~/env";
import type { FetchPlaylistT, PlaylistVideosT } from "~/types";
import { fetchFn } from "~/API";
import PlaylistVideos from "./playlistVideos";
import PlayerSheet from "./playerSheet";
import { Link, useLocation } from "react-router";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";

function PlayingPlaylist({playlistId, videoId, onClose}: {playlistId: string, videoId: string, onClose: () => void}){
    const { t } = useI18n();
    const queryClient = useQueryClient();
    const savingRef = useRef(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const { can } = useAuthorization();
    const location = useLocation();

    const token = getToken() ?? "";
    const [isAutoPlayOn, setAutoPlay] = useState(() => {
        const v = localStorage.getItem("autoplay");
        return v === null ? true : v === "true";
    });
    const [isSaved, setIsSaved] = useState(false);
    const [saveCount, setSaveCount] = useState(0);

    function changeAutoPlay() {
        setAutoPlay(prev => {
            const next = !prev;
            localStorage.setItem("autoplay", String(next));
            return next;
        });
    }

    const myHeaders = useMemo(() => {
        const headers = new Headers();
        if (token) {
            headers.set("Authorization", `Bearer ${token}`);
        }
        return headers;
    }, [token]);

    const playlistQuery = useQuery({
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

    const data = playlistQuery.data?.playlist;

    const videosQuery = useQuery({
        queryKey: [`playlist-videos${playlistId}`, "all"],
        queryFn: async ({ signal }) => {
            const videos: PlaylistVideosT["videos"] = [];
            let page = 1;
            while (true) {
                const response = await fetchFn<PlaylistVideosT>({
                    route: `api/playlists/${playlistId}/videos?limit=100&page=${page}`,
                    options: { method: "GET", headers: myHeaders, signal },
                });
                videos.push(...response.videos);
                if (!response.pagination.hasNextPage || page >= response.pagination.totalPages) break;
                page++;
            }
            return Array.from(new Map(videos.map(video => [video.id, video])).values());
        },
        enabled: !!playlistId,
    });
    const loading = playlistQuery.isPending || videosQuery.isPending;
    const loadError = playlistQuery.isError || videosQuery.isError;

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
        if (data && !savingRef.current) {
            setIsSaved(!!data.is_saved);
            setSaveCount(data.save_count ?? 0);
        }
    }, [data?.is_saved, data?.save_count, saving]);

    const toggleSave = async () => {
        if (!can(P.playlistsSave) || savingRef.current) return;
        if (!data?.id || !token) return;

        savingRef.current = true;
        setSaving(true);
        setSaveError(false);
        await queryClient.cancelQueries({ queryKey: [`playlist${playlistId}`] });
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

            if (!response.ok) throw new Error("Playlist save failed");
            const result = await response.json();
            if (typeof result?.is_saved !== "boolean") throw new Error("Invalid playlist save response");

            if (typeof result?.is_saved === "boolean") setIsSaved(result.is_saved);
            if (typeof result?.save_count === "number") setSaveCount(result.save_count);
            queryClient.setQueryData<FetchPlaylistT>([`playlist${playlistId}`], previous => previous ? {
                ...previous, playlist: { ...previous.playlist, is_saved: result.is_saved,
                    save_count: typeof result.save_count === "number" ? result.save_count : prevCount + (result.is_saved === prevSaved ? 0 : result.is_saved ? 1 : -1) },
            } : previous);

        } catch {
            setSaveError(true);
            setIsSaved(prevSaved);
            setSaveCount(prevCount);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return (
        <PlayerSheet label={data?.title || t("playlistLabel")} onClose={onClose} header={handleClose => (<>
                <span className="titleBar">
                    <Link to={`/playlist/${playlistId}`}>
                        <h2>{data?.title || t("playlistLabel")}</h2>
                        <p>
                            {data ? <>{t("playlistLabel")} · {t("videosLabel", { count: data.video_count })} · {t("saveCountLabel", { count: saveCount })}</> : t("playlistLoading")}
                        </p>
                    </Link>
                    <button onClick={handleClose} aria-label={t("close")}>{CloseSVG}</button>
                </span>
                <span className="tagsHolder">
                    <span className="tags">
                        <button className="whiteTag" onClick={changeAutoPlay} title={t("toggleAutoplay")}>{AutoPlaySVG}&nbsp;{isAutoPlayOn ? t("on") : t("off")}</button>
                        <button className={`${isSaved ? "saved" : ""} clickable`} onClick={toggleSave} disabled={!can(P.playlistsSave) || !data || saving} aria-busy={saving}>{BookmarkSVG}&nbsp;{isSaved ? t("saved") : t("save")}</button>
                        <button onClick={e => sharePlaylistLink(e)} title={t("sharePlaylist")}>{ShareSVG}&nbsp;{t("share")}</button>
                    </span>
                </span>
                {saveError && <p role="alert">{t("somethingWentWrong")}</p>}
            </>)}>
            {loadError ? <div className="similar sheetState" role="alert">
                <p>{t("somethingWentWrong")}</p>
                <button type="button" className="button rounded-full px-4 py-2 bg-(--accentBlue) text-(--text1)" disabled={playlistQuery.isFetching || videosQuery.isFetching}
                    onClick={() => { void playlistQuery.refetch(); void videosQuery.refetch(); }}>{t("usersRetry")}</button>
            </div> : loading ? <div className="similar sheetState" role="status" aria-busy="true">{t("playlistLoading")}</div>
            : !videosQuery.data?.length ? <div className="similar sheetState" role="status">{t("noVideosInPlaylist")}</div>
            : <PlaylistVideos playlistId={playlistId} videos={videosQuery.data} playedVideoId={videoId} />}
        </PlayerSheet>
    );
}

export default memo(PlayingPlaylist);
