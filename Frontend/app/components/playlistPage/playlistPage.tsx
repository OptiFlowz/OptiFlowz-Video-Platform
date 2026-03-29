import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, useCallback } from "react";
import { formatDescription, getToken } from "~/functions";
import { useParams } from "react-router";
import { fetchFn } from "~/API";
import { BookmarkSVG, PlaySVG, ShareSVG } from "~/constants";
import DefaultThumbnail from "../../../assets/DefaultThumbnail.webp";
import type { PlaylistT, VideoT } from "~/types";
import Item from "../itemSlider/item";
import { useI18n } from "~/i18n";

const SkeletonVideoItem = () => (
    <div className="skeleton-item">
        <div className="skeleton-thumbnail"></div>
        <div className="skeleton-content">
            <div className="skeleton-title"></div>
            <div className="skeleton-text"></div>
            <div className="skeleton-text short"></div>
        </div>
    </div>
);

const SkeletonHeader = () => (
    <div className="playlistHeaderLoader relative flex items-start gap-5 overflow-hidden">
        <div className="skeleton-playlist-banner w-full rounded-[15px] z-1"></div>

        <span className="flex flex-col gap-3 z-1 w-full">
            <div className="skeleton-title-large"></div>
            <div className="skeleton-text-small"></div>
            <span className="buttonHolder gap-3 flex">
                <div className="skeleton-button"></div>
                <div className="skeleton-button"></div>
                <div className="skeleton-button"></div>
            </span>
            <div className="skeleton-description"></div>
            <div className="skeleton-description"></div>
        </span>
    </div>
);

function PlaylistPage(){
    const { t } = useI18n();
    const {id: playlistId} = useParams();
    const myHeaders = useRef(new Headers());
    const [token, setToken] = useState(String);
    const [descOpen, setDescOpen] = useState(false);
    const readMoreButtonRef = useRef<HTMLButtonElement>(null);
    const [isSaved, setIsSaved] = useState(false);
    const [saveCount, setSaveCount] = useState(0);

    const sharePlaylistLink = useCallback((e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        e.preventDefault();
        const fullPath = import.meta.env.VITE_SITE_URL + location.pathname + location.search + location.hash;

        if(navigator.share)
            return navigator.share({
                title: t("playlistShareTitle"),
                text: t("playlistShareText"),
                url: fullPath
            });

        if(navigator.clipboard && window.isSecureContext)
            return navigator.clipboard.writeText(fullPath);
    }, [t]);

    function playPlaylist(){
        document.querySelector<HTMLAnchorElement>(".playlistStartVideo")?.click();
    }

    const toggleDescOpen = () => {
        if(!readMoreButtonRef.current) return;

        if(descOpen){
            readMoreButtonRef.current.innerHTML = t("readMore");
            setDescOpen(false);
        }else{
            readMoreButtonRef.current.innerHTML = t("readLess");
            setDescOpen(true);
        }
    };

    useLayoutEffect(() => {
        const userToken = getToken();
        if(!userToken) return;
        setToken(userToken);

        if(token)
            myHeaders.current.append("Authorization", `Bearer ${userToken}`);
    }, [token]);

    const {data, isLoading} = useQuery({
        queryKey: [`playlist${playlistId}`],
        queryFn: () => fetchFn<PlaylistT>({
            route: `api/playlists/${playlistId}`,
            options: {
                method: "GET",
                headers: myHeaders.current
            }
        }),
        enabled: !!token
    });

    const toggleSave = async () => {
        if (!data?.id) return;

        const prevSaved = isSaved;
        const prevCount = saveCount;

        const optimisticNext = !prevSaved;
        setIsSaved(optimisticNext);
        setSaveCount((c) => c + (optimisticNext ? 1 : -1));

        try {
            const myHeaders = new Headers();
            myHeaders.set("Authorization", `Bearer ${JSON.parse(localStorage.user).token}`);
            myHeaders.set("Content-Type", "application/json");

            const response = await fetch(
                `${import.meta.env.VITE_FIRST}/api/playlists/${data.id}/save`,
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

    useLayoutEffect(() => {
        if (data) {
            setIsSaved(!!data.is_saved);
            setSaveCount(data.save_count ?? 0);
        }
    }, [data?.is_saved, data?.save_count]);

    const skeletonVideoArray = Array.from({ length: 8 }).map((_, index) => (
        <SkeletonVideoItem key={`skeleton-video-${index}`} />
    ));

    const videoArray = data?.videos?.map((video, index) =>
        <Item key={video.id} props={video as any as VideoT} playlistIndex={index+1} playlistId={playlistId} />
    );

    if (isLoading) {
        return (
            <main className="playlist">
                <SkeletonHeader />
                <div className="videoHolder">{skeletonVideoArray}</div>
            </main>
        );
    }

    return (
        <main className="playlist">
            <div className="relative flex items-start gap-5">
                <img className="plBanner w-100 rounded-[15px] z-1" src={data?.thumbnail_url?.replace(/width=\d+/i, `width=${800}`)?.replace(/height=\d+/i, `height=${600}`) || DefaultThumbnail} alt="" />

                <span className="flex flex-col gap-3 z-1 w-full">
                    <h2 className="subTitle pb-0!">{data?.title}</h2>

                    <p className="mobileViewAndLikeCount -mb-1.25">
                        {t("videosLabel", { count: data?.video_count || 0 })} · {t("saveCountLabel", { count: saveCount })} · {t("viewsLabel", { count: data?.view_count || 0 })}
                    </p>

                    <span className="buttonHolder">
                        <button className="play rounded-full! flex! bg-(--accentBlue)! text-white! font-semibold!" onClick={playPlaylist}>{PlaySVG}&nbsp;{t("playAll")}</button>

                        <button className={`${isSaved ? "saved" : ""} clickable bg-(--background2) hover:bg-(--background3) rounded-full flex`} onClick={toggleSave}>{BookmarkSVG}&nbsp;{isSaved ? t("saved") : t("save")}</button>
                        <button onClick={e => sharePlaylistLink(e)} className="clickable bg-(--background2) hover:bg-(--background3) rounded-full flex">{ShareSVG}&nbsp;{t("share")}</button>
                    </span>

                    <p className={`description ${descOpen ? "open" : ""}`}>{formatDescription(data?.description)}</p>
                    {data?.description && (
                        <button ref={readMoreButtonRef} className="w-fit hover:underline cursor-pointer" onClick={() => toggleDescOpen()}>{t("readMore")}</button>
                    )}
                </span>
            </div>

            <div className="videoHolder">{videoArray}</div>

            {data?.video_count === 0 && (
                <p className="noVideosMessage">{t("noVideosInPlaylist")}</p>
            )}
        </main>
    );
}

export default PlaylistPage;
