import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useState, useCallback, useMemo } from "react";
import { env } from "~/env";
import { getToken } from "~/functions";
import { useParams } from "react-router";
import { fetchFn, fetchApiResponse } from "~/API";
import { BookmarkSVG, PlaySVG, ShareSVG } from "~/constants";
import DefaultThumbnail from "../../../assets/DefaultThumbnail.webp";
import type { FetchPlaylistT, PlaylistT, PlaylistVideosT, VideoT } from "~/types";
import Item from "../itemSlider/item";
import { useI18n } from "~/i18n";
import ExpandableDescription from "../shared/ExpandableDescription";
import { useImagePalette } from "~/hooks/useImagePalette";
import "./playlistPage.css";

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
    <div className="playlistHero playlistHeaderLoader">
        <div className="playlistHeroCover skeleton-playlist-banner"></div>

        <span className="playlistHeroInfo">
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
    const { can } = useAuthorization();
    const {id: playlistId} = useParams();
    const token = getToken() ?? "";
    const [isSaved, setIsSaved] = useState(false);
    const [saveCount, setSaveCount] = useState(0);

    const sharePlaylistLink = useCallback((e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
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
    }, [t]);

    function playPlaylist(){
        document.querySelector<HTMLAnchorElement>(".playlistStartVideo")?.click();
    }


    const myHeaders = useMemo(() => {
        const headers = new Headers();
        if (token) {
            headers.set("Authorization", `Bearer ${token}`);
        }
        return headers;
    }, [token]);

    const {data: playlistResponse, isLoading: isLoadingPlaylist} = useQuery({
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
    const thumbnail = data?.thumbnail_url || DefaultThumbnail;
    const paletteStyle = useImagePalette(thumbnail);

    const {data: playlistVideosResponse, isLoading: isLoadingVideos} = useQuery({
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

    const toggleSave = async () => {
        if (!can(P.playlistsSave)) return;
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

            const response = await fetchApiResponse(
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

    useLayoutEffect(() => {
        if (data) {
            setIsSaved(!!data.is_saved);
            setSaveCount(data.save_count ?? 0);
        }
    }, [data?.is_saved, data?.save_count]);

    const skeletonVideoArray = Array.from({ length: 8 }).map((_, index) => (
        <SkeletonVideoItem key={`skeleton-video-${index}`} />
    ));

    const playlistVideos = playlistVideosResponse?.videos ?? [];

    const videoArray = playlistVideos.map((video, index) =>
        <Item key={video.id} props={video as any as VideoT} playlistIndex={index+1} playlistId={playlistId} />
    );

    if (isLoadingPlaylist || isLoadingVideos) {
        return (
            <main className="playlist playlistDetailsPage">
                <SkeletonHeader />
                <div className="videoHolder">{skeletonVideoArray}</div>
            </main>
        );
    }

    return (
        <main className="playlist playlistDetailsPage">
            <div className="playlistHero" style={paletteStyle}>
                <img className="plBanner playlistHeroCover" src={thumbnail} alt="" onError={event => { if (event.currentTarget.getAttribute("src") !== DefaultThumbnail) event.currentTarget.src = DefaultThumbnail; }} />

                <span className="playlistHeroInfo">
                    <h2 className="playlistHeroTitle">{data?.title}</h2>

                    <p className="playlistHeroStats">
                        {t("videosLabel", { count: data?.video_count || 0 })} · {t("saveCountLabel", { count: saveCount })} · {t("viewsLabel", { count: data?.view_count || 0 })}
                    </p>

                    <span className="buttonHolder">
                        <button className="play" onClick={playPlaylist}>{PlaySVG}&nbsp;{t("playAll")}</button>

                        <button className={`${isSaved ? "saved" : ""} clickable`} onClick={toggleSave} disabled={!can(P.playlistsSave)}>{BookmarkSVG}&nbsp;{isSaved ? t("saved") : t("save")}</button>
                        <button onClick={e => sharePlaylistLink(e)} className="clickable">{ShareSVG}&nbsp;{t("share")}</button>
                    </span>

                    {data?.description && <div className="playlistHeroAbout">
                        <ExpandableDescription key={playlistId} text={data.description} />
                    </div>}
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
