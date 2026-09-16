import { useParams, useLocation, useNavigate } from "react-router";
import PlayerCollection from "./playerCollection/playerCollection";
import Similar from "./playerCollection/similar";
import VideoInfo from "./playerCollection/videoInfo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import { fetchVectorVideos } from "~/videoDiscovery";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SimilarT, VideoT } from "~/types";
import InPlaylist from "./inPlaylist";
import PlayingPlaylist from "./playerCollection/playingPlaylist";
import { getToken, QUIZ_RETURN_PATH_STORAGE_KEY } from "~/functions";
import VideoChapters, { type PanelView } from "./playerCollection/videoChapters";
import { OPEN_NOTES_EVENT, type OpenNotesDetail } from "./notes/videoNotes";
import CommentsSection from "./commentsSection";
import { useI18n } from "~/i18n";

const VIDEO_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseVideoSearch(search: string) {
    const params = new URLSearchParams(search);
    const rawTime = params.get("time");
    const parsedTime = rawTime == null ? null : Number(rawTime);

    return {
        playlistId: params.get("p"),
        isFromQuiz: params.get("from_quiz") === "true",
        startTimeOverride: rawTime != null && parsedTime != null && Number.isFinite(parsedTime) && parsedTime >= 0 ? parsedTime : null,
    };
}

function PlayPage(){
    const {videoId} = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useI18n();
    const queryClient = useQueryClient();
    const [showChapters, setShowChapters] = useState(false);
    const [chapterPanelView, setChapterPanelView] = useState<PanelView>("chapters");
    const [notesRequest, setNotesRequest] = useState<OpenNotesDetail>();
    const [showComments, setShowComments] = useState(false);
    const [isTheater, setIsTheater] = useState(false);
    const [isMobileCommentsDrawer, setIsMobileCommentsDrawer] = useState(false);
    const theaterEnabled = useRef(true);
    const chaptersRef = useRef<HTMLDivElement | null>(null);
    const playlistRef = useRef<HTMLDivElement | null>(null);
    const { playlistId, isFromQuiz, startTimeOverride } = useMemo(
        () => parseVideoSearch(location.search),
        [location.search]
    );

    const scrollToPanel = (ref: { current: HTMLDivElement | null }) => {
        if (window.matchMedia("(max-width: 500px)").matches) return;

        requestAnimationFrame(() => {
            const element = ref.current;
            if (!element) return;

            const header = document.querySelector("header") as HTMLElement | null;
            const headerHeight = header?.offsetHeight ?? 0;
            const top = element.getBoundingClientRect().top + window.scrollY - headerHeight - 16;

            window.scrollTo({
                top: Math.max(top, 0),
                behavior: "smooth",
            });
        });
    };

    const handleClose = () => {
        if (!playlistId) {
            return;
        }

        const params = new URLSearchParams(location.search);
        params.delete("p");

        const newSearch = params.toString();
        navigate(
        {
            pathname: location.pathname,
            search: newSearch ? `?${newSearch}` : "",
        },
        { replace: true, preventScrollReset: true }
        );
    };

    const handleCloseChapters = () => {
        setShowChapters(false);
    };

    const handleCloseComments = () => {
        setShowComments(false);
    };

    const handleBackToQuiz = () => {
        if (typeof window !== "undefined") {
            let quizReturnPath: string | null = null;

            try {
                quizReturnPath = window.localStorage.getItem(QUIZ_RETURN_PATH_STORAGE_KEY);
            } catch {
                quizReturnPath = null;
            }

            if (quizReturnPath?.startsWith("/quiz/")) {
                navigate(quizReturnPath);
                return;
            }
        }

        navigate(-1);
    };

    function openChapters() {
        setNotesRequest(undefined);
        setChapterPanelView("chapters");
        setShowChapters(true);
        setShowComments(false);
        handleClose();
    }

    function openTranscript() {
        setNotesRequest(undefined);
        setChapterPanelView("transcript");
        setShowChapters(true);
        setShowComments(false);
        handleClose();
    }

    function openNotes(request?: OpenNotesDetail) {
        setNotesRequest(request);
        setChapterPanelView("notes");
        setShowChapters(true);
        setShowComments(false);
        handleClose();
    }

    function openComments() {
        setShowComments(true);
        setShowChapters(false);
        handleClose();
    }

    const token = getToken() ?? "";

    const myHeaders = useMemo(() => {
        const h = new Headers();
        if (token) h.set("Authorization", `Bearer ${token}`);
        return h;
    }, [token]);

    const validVideoId = VIDEO_ID_PATTERN.test(videoId ?? "");
    const { data, isFetchedAfterMount, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["video", videoId],
        enabled: validVideoId,
        staleTime: 4 * 60 * 1000,
        refetchOnMount: "always",
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
            const status = (error as { status?: number }).status;
            if (status && status >= 400 && status < 500) return false;
            return failureCount < 2;
        },
        queryFn: ({ signal }) =>
            fetchFn<VideoT | null>({
                route: `api/videos/${videoId}`,
                options: { method: "GET", headers: myHeaders, signal },
            }),
    });
    const videoData = isFetchedAfterMount && !isError ? data ?? undefined : undefined;
    const isVideoLoading = validVideoId && !isError && (isLoading || !isFetchedAfterMount);
    const videoStatus = (error as { status?: number } | null)?.status;
    const videoNotFound = !validVideoId || videoStatus === 404 || videoStatus === 410
        || (!isVideoLoading && !isError && !videoData?.id);

    useEffect(() => {
        return () => {
            queryClient.invalidateQueries({ queryKey: ["video", videoId] });
        };
    }, [queryClient, videoId]);

    useEffect(() => {
        const enforceTheaterRule = () => {
            const isSmall = window.matchMedia("(max-width: 1075px)").matches;
            const isCommentsDrawerMobile = window.matchMedia("(max-width: 500px)").matches;

            setIsMobileCommentsDrawer(isCommentsDrawerMobile);
            if (!isCommentsDrawerMobile) {
                setShowComments(false);
            }

            if (isSmall){
                if(theaterEnabled.current){
                    window.dispatchEvent(new CustomEvent('theater-disable', { bubbles: true, composed: true }));
                    theaterEnabled.current = false;
                }

                setIsTheater(false);
                return;
            }

            if(!theaterEnabled.current){
                window.dispatchEvent(new CustomEvent('theater-enable', { bubbles: true, composed: true }));
                theaterEnabled.current = true;
            }
        };
        enforceTheaterRule();

        const handleTheaterMode = () => {
            const isSmall = window.matchMedia("(max-width: 1075px)").matches;

            if (isSmall) {
                setIsTheater(false);
                return;
            }

            setIsTheater(prev => !prev);
        };

        window.addEventListener("theater-mode", handleTheaterMode);
        window.addEventListener("resize", enforceTheaterRule);

        return () => {
            window.removeEventListener("resize", enforceTheaterRule);
            window.removeEventListener("theater-mode", handleTheaterMode);
        };
    }, []);

    useEffect(() => {
        const handler = () => openChapters();
        window.addEventListener("open-chapter-menu", handler);
        return () => window.removeEventListener("open-chapter-menu", handler);
    }, [playlistId, location.pathname, location.search, navigate]);

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<OpenNotesDetail>).detail;
            if (detail?.videoId === videoId) openNotes(detail);
        };
        window.addEventListener(OPEN_NOTES_EVENT, handler);
        return () => window.removeEventListener(OPEN_NOTES_EVENT, handler);
    }, [videoId, playlistId, location.pathname, location.search, navigate]);

    useLayoutEffect(() => {
        if (playlistId) {
            setShowChapters(false);
            setShowComments(false);
        }
    }, [playlistId]);

    useEffect(() => {
        if (showChapters) {
            scrollToPanel(chaptersRef);
        }
    }, [showChapters, chapterPanelView]);

    useEffect(() => {
        if (playlistId) {
            scrollToPanel(playlistRef);
        }
    }, [playlistId]);

    const {data: similarData, isLoading: isLoadingSimilar} = useQuery({
        queryKey: ["similar-videos", videoId],
        queryFn: ({ signal }) => fetchVectorVideos<SimilarT>({
            route: `api/videos/${videoId}/similar`,
            options: {
                signal,
                method: "GET",
                headers: myHeaders
            }
        }),
        staleTime: 4 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        enabled: !!videoData?.id && !videoNotFound
    });

    const resolvedSimilarData = similarData as SimilarT | undefined;
    const hasSimilarVideos = (resolvedSimilarData?.videos?.length ?? 0) > 0;
    const hasRelevantPanelsOpen = showChapters || showComments || !!playlistId;
    const isCompactRelevant = !isLoadingSimilar && !hasSimilarVideos && !hasRelevantPanelsOpen;
    const backToQuizButton = isFromQuiz ? (
        <button type="button" className="backToQuizButton" onClick={handleBackToQuiz}>
            {t("quizBackToQuiz")}
        </button>
    ) : null;

    if (videoNotFound) {
        return <main className="videos"><div className="platformUsersState" role="status">
            <h1>{t("videoNotFound")}</h1>
        </div></main>;
    }

    if (isError) {
        return <main className="videos"><div className="platformUsersState" role="alert">
            <p>{t("videoAnalyticsLoadFailed")}</p>
            <button type="button" className="button" onClick={() => void refetch()}>{t("usersRetry")}</button>
        </div></main>;
    }

    if (isVideoLoading) {
        return <main className="play px-0 py-7.5" aria-busy="true" aria-label={t("videoLoadingData")}>
            <div className="player aspect-video"><div className="player-skeleton" aria-hidden="true">
                <div className="player-skeleton__controls">
                    <span className="player-skeleton__chip player-skeleton__chip--wide" />
                    <span className="player-skeleton__chip" />
                    <span className="player-skeleton__chip player-skeleton__chip--short" />
                </div>
            </div></div>
        </main>;
    }

    return <>
        <main className={`play ${isTheater ? "theater pt-23!" : ""} px-0 py-7.5`}>
            {
                !isTheater 
                ? <>
                    <div className="flex flex-col gap-5 overflow-x-hidden">
                        <PlayerCollection
                            props={videoData}
                            startTimeOverride={startTimeOverride}
                            forceAutoplay={isFromQuiz}
                        />

                        <VideoInfo
                            props={videoData}
                            isLoading={isVideoLoading}
                            onOpenChapter={openChapters}
                            onOpenTranscript={openTranscript}
                            onOpenNotes={() => openNotes()}
                            onOpenComments={ isMobileCommentsDrawer ? openComments : undefined }
                            topAction={backToQuizButton}
                        />

                        {videoData?.playlists && <InPlaylist props={videoData?.playlists} />}

                        {videoId && !isMobileCommentsDrawer && <CommentsSection videoId={videoId} />}
                    </div>

                    <div className={`relevant flex flex-col gap-7 ${isCompactRelevant ? "relevant--compact" : ""}`}>
                        {showChapters && videoData ? <div ref={chaptersRef}><VideoChapters key={`${videoId}-${chapterPanelView}`} props={videoData} initialView={chapterPanelView} notesRequest={notesRequest} onClose={() => handleCloseChapters()} /></div> : ""}
                        {showComments && videoId ? <CommentsSection videoId={videoId} variant="drawer" onClose={() => handleCloseComments()} /> : ""}
                        {playlistId ? <div ref={playlistRef}><PlayingPlaylist key={playlistId} playlistId={playlistId} videoId={videoId || ""} onClose={() => handleClose()} /></div> : ""}
                        <Similar props={resolvedSimilarData} isLoading={isLoadingSimilar} />
                    </div>
                </>
                : <>
                    <div className="flex flex-col gap-5 overflow-x-hidden mx-auto">
                        <PlayerCollection
                            props={videoData ? {...videoData, class: "theater"} : undefined}
                            startTimeOverride={startTimeOverride}
                            forceAutoplay={isFromQuiz}
                        />
                        
                        <div className="flex gap-5 overflow-x-hidden">
                            <div className="flex flex-col gap-5 overflow-x-hidden">
                                <VideoInfo props={videoData} isLoading={isVideoLoading} onOpenChapter={openChapters} onOpenTranscript={openTranscript} onOpenNotes={() => openNotes()} topAction={backToQuizButton} />

                                {videoData?.playlists && <InPlaylist props={videoData?.playlists} />}

                                {videoId && <CommentsSection videoId={videoId} />}
                            </div>

                            <div className={`relevant flex flex-col gap-7 ${isCompactRelevant ? "relevant--compact" : "min-w-110"}`}>
                                {showChapters && videoData ? <div ref={chaptersRef}><VideoChapters key={`${videoId}-${chapterPanelView}`} props={videoData} initialView={chapterPanelView} notesRequest={notesRequest} onClose={() => handleCloseChapters()} /></div> : ""}
                                {playlistId ? <div ref={playlistRef}><PlayingPlaylist key={playlistId} playlistId={playlistId} videoId={videoId || ""} onClose={() => handleClose()} /></div> : ""}
                                <Similar props={resolvedSimilarData} isLoading={isLoadingSimilar} />
                            </div> 
                        </div>
                    </div>
                </>
            }
            
        </main>
    </>;
}

export default PlayPage;
