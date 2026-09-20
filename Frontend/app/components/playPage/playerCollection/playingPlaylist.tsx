import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useLayoutEffect, useState, useCallback, useMemo, useRef, useEffect } from "react";
import { AutoPlaySVG, BookmarkSVG, CloseSVG, ShareSVG } from "~/constants";
import { env } from "~/env";
import type { FetchPlaylistT, PlaylistVideosT } from "~/types";
import { fetchFn, fetchApiResponse } from "~/API";
import PlaylistVideos from "./playlistVideos";
import InfiniteScroll from "~/components/library/infiniteScroll";
import { nextResultsPage, uniqueResults } from "~/components/library/infiniteResults";
import { PLAYLIST_ADVANCE_EVENT } from "./playlistAutoplay";
import PlayerSheet from "./playerSheet";
import { Link, useLocation, useNavigate } from "react-router";
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
    const navigate = useNavigate();
    const [advanceFrom, setAdvanceFrom] = useState<string | null>(null);

    const token = getToken() ?? "";
    const [isAutoPlayOn, setAutoPlay] = useState(() => {
        const v = typeof window === "undefined" ? null : window.localStorage.getItem("autoplay");
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
        queryFn: ({ signal }) => fetchFn<FetchPlaylistT>({
            route: `api/playlists/${playlistId}`,
            options: {
                method: "GET",
                headers: myHeaders, signal
            }
        }),
        enabled: !!playlistId,
        staleTime: 30_000,
    });

    const data = playlistQuery.data?.playlist;

    const videosQuery = useInfiniteQuery({
        queryKey: [`playlist-videos${playlistId}`, "infinite", token],
        initialPageParam: 1,
        queryFn: ({ signal, pageParam }) => fetchFn<PlaylistVideosT>({
            route: `api/playlists/${playlistId}/videos?limit=20&page=${pageParam}`,
            options: { method: "GET", headers: myHeaders, signal },
        }),
        getNextPageParam: (last, pages, page) => nextResultsPage(last, pages, page, 20, response => response.videos),
        enabled: !!playlistId,
        staleTime: 30_000,
    });
    const videos = useMemo(() => uniqueResults(videosQuery.data?.pages.flatMap(page => page.videos) ?? []), [videosQuery.data]);
    const currentIndex = videos.findIndex(video => video.id === videoId);
    const nextVideo = currentIndex >= 0 ? videos[currentIndex + 1] : undefined;
    const { fetchNextPage, hasNextPage, isFetching, isError, isFetchNextPageError, refetch } = videosQuery;
    const loadMore = useCallback(() => {
        if (isError && !isFetchNextPageError) void refetch();
        else void fetchNextPage({ cancelRefetch: false });
    }, [isError, isFetchNextPageError, refetch, fetchNextPage]);

    // The API exposes page/limit, not a video-position lookup. Only read ahead
    // until the active video and its successor are found; render each page as it arrives.
    useEffect(() => {
        if (!videoId || !videos.length || !hasNextPage || isFetching || isError) return;
        if (currentIndex < 0 || !nextVideo) void fetchNextPage({ cancelRefetch: false });
    }, [videoId, videos.length, currentIndex, nextVideo, hasNextPage, isFetching, isError, fetchNextPage]);

    useEffect(() => {
        const advance = (event: Event) => {
            const request = event as CustomEvent<{ videoId: string }>;
            if (request.defaultPrevented || request.detail?.videoId !== videoId) return;
            request.preventDefault();
            setAdvanceFrom(videoId);
        };
        window.addEventListener(PLAYLIST_ADVANCE_EVENT, advance);
        return () => window.removeEventListener(PLAYLIST_ADVANCE_EVENT, advance);
    }, [videoId]);

    useEffect(() => {
        if (!advanceFrom) return;
        if (advanceFrom !== videoId || localStorage.getItem("autoplay") === "false") {
            setAdvanceFrom(null);
            return;
        }
        if (nextVideo) {
            setAdvanceFrom(null);
            navigate(`/video/${encodeURIComponent(nextVideo.id)}?p=${encodeURIComponent(playlistId)}`);
        } else if (!hasNextPage && !isFetching && !isError) {
            setAdvanceFrom(null);
        }
    }, [advanceFrom, videoId, nextVideo, playlistId, hasNextPage, isFetching, isError, navigate]);

    const loading = playlistQuery.isPending || videosQuery.isPending;
    const loadError = playlistQuery.isError || (videosQuery.isError && !videos.length);

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

            const response = await fetchApiResponse(
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
            : !videos.length ? <div className="similar sheetState" role="status">{t("noVideosInPlaylist")}</div>
            : <PlaylistVideos playlistId={playlistId} videos={videos} playedVideoId={videoId}>
                <InfiniteScroll hasMore={hasNextPage} fetching={isFetching} error={isError}
                    onLoadMore={loadMore} loadingLabel={t("playlistLoading")} />
            </PlaylistVideos>}
        </PlayerSheet>
    );
}

export default memo(PlayingPlaylist);
