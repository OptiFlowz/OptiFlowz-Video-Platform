import { useParams, useSearchParams, useLocation, useNavigate } from "react-router";
import PlayerCollection from "./playerCollection/playerCollection";
import Similar from "./playerCollection/similar";
import VideoInfo from "./playerCollection/videoInfo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SimilarT, VideoT } from "~/types";
import InPlaylist from "./inPlaylist";
import PlayingPlaylist from "./playerCollection/playingPlaylist";
import { getToken } from "~/functions";
import VideoChapters from "./playerCollection/videoChapters";
import CommentsSection from "./commentsSection";

function PlayPage(){
    const {videoId} = useParams();
    const [searchParams] = useSearchParams();
    const playlistId = searchParams.get("p");
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const [showChapters, setShowChapters] = useState(false);
    const [showComments, setShowComments] = useState(false);
    const [isTheater, setIsTheater] = useState(false);
    const [isMobileCommentsDrawer, setIsMobileCommentsDrawer] = useState(false);
    const theaterEnabled = useRef(true);
    const chaptersRef = useRef<HTMLDivElement | null>(null);
    const playlistRef = useRef<HTMLDivElement | null>(null);

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

    function openChapters() {
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

    const { data, isLoading } = useQuery({
        queryKey: ["video", videoId],
        enabled: Boolean(videoId && token),
        staleTime: 4 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: ({ signal }) =>
            fetchFn({
                route: `api/videos/${videoId}`,
                options: { method: "GET", headers: myHeaders, signal },
            }),
    });

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
        const handler = () => setShowChapters(true);
        window.addEventListener("open-chapter-menu", handler);
        return () => window.removeEventListener("open-chapter-menu", handler);
    }, []);

    useEffect(() => {
        if (showChapters) {
            scrollToPanel(chaptersRef);
        }
    }, [showChapters]);

    useEffect(() => {
        if (playlistId) {
            scrollToPanel(playlistRef);
        }
    }, [playlistId]);

    const {data: similarData, isLoading: isLoadingSimilar} = useQuery({
        queryKey: ["similar-videos", videoId],
        queryFn: () => fetchFn({
            route: `api/videos/${videoId}/similar`,
            options: {
                method: "GET",
                headers: myHeaders
            }
        }),
        staleTime: 4 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        enabled: !!token
    });

    const videoData = data as VideoT;

    return <>
        <main className={`play ${isTheater ? "theater pt-18.25!" : ""} px-0 py-7.5`}>
            {
                !isTheater 
                ? <>
                    <div className="flex flex-col gap-5 overflow-x-hidden">
                        <PlayerCollection props={videoData} />

                        <VideoInfo
                            props={videoData}
                            isLoading={isLoading}
                            onOpenChapter={openChapters}
                            onOpenComments={ isMobileCommentsDrawer ? openComments : undefined }
                        />

                        {videoData?.playlists && <InPlaylist props={videoData?.playlists} />}

                        {videoId && !isMobileCommentsDrawer && <CommentsSection videoId={videoId} />}
                    </div>

                    <div className="relevant flex flex-col gap-7">
                        {showChapters && data ? <div ref={chaptersRef}><VideoChapters props={videoData} onClose={() => handleCloseChapters()} /></div> : ""}
                        {showComments && videoId ? <CommentsSection videoId={videoId} variant="drawer" onClose={() => handleCloseComments()} /> : ""}
                        {playlistId ? <div ref={playlistRef}><PlayingPlaylist playlistId={playlistId} videoId={videoId || ""} onClose={() => handleClose()} /></div> : ""}
                        <Similar props={similarData as SimilarT} isLoading={isLoadingSimilar} />
                    </div>
                </>
                : <>
                    <div className="flex flex-col gap-5 overflow-x-hidden mx-auto">
                        <PlayerCollection props={{...videoData, class: "theater"}} />
                        
                        <div className="flex gap-5 overflow-x-hidden">
                            <div className="flex flex-col gap-5 overflow-x-hidden">
                                <VideoInfo props={videoData} isLoading={isLoading} onOpenChapter={openChapters} />

                                {videoData?.playlists && <InPlaylist props={videoData?.playlists} />}

                                {videoId && <CommentsSection videoId={videoId} />}
                            </div>

                            <div className="relevant flex flex-col gap-7 min-w-110">
                                {showChapters && data ? <div ref={chaptersRef}><VideoChapters props={videoData} onClose={() => handleCloseChapters()} /></div> : ""}
                                {playlistId ? <div ref={playlistRef}><PlayingPlaylist playlistId={playlistId} videoId={videoId || ""} onClose={() => handleClose()} /></div> : ""}
                                <Similar props={similarData as SimilarT} isLoading={isLoadingSimilar} />
                            </div> 
                        </div>
                    </div>
                </>
            }
            
        </main>
    </>;
}

export default PlayPage;
