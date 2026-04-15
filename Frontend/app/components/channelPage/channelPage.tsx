import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useParams } from "react-router";
import { fetchFn } from "~/API";
import { PlaySVG, ShareSVG } from "~/constants";
import { env } from "~/env";
import { formatDescription, getToken } from "~/functions";
import { useI18n } from "~/i18n";
import type { ChannelT, ChannelVideosT, FetchChannelT, VideoT } from "~/types";
import Item from "../itemSlider/item";
import DefaultProfile from "../../../assets/DefaultProfile.webp";

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
            </span>
            <div className="skeleton-description"></div>
            <div className="skeleton-description"></div>
        </span>
    </div>
);

function ChannelPage() {
    const { t } = useI18n();
    const { id: channelId } = useParams();
    const [descOpen, setDescOpen] = useState(false);
    const [hasDescriptionOverflow, setHasDescriptionOverflow] = useState(false);
    const descriptionRef = useRef<HTMLParagraphElement>(null);
    const token = getToken();

    const headers = useMemo(() => {
        const nextHeaders = new Headers();
        if (token) {
            nextHeaders.set("Authorization", `Bearer ${token}`);
        }
        return nextHeaders;
    }, [token]);

    const shareChannelLink = useCallback((e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        e.preventDefault();
        const fullPath = env.siteUrl + location.pathname + location.search + location.hash;

        if (navigator.share) {
            return navigator.share({
                title: "Channel",
                text: "Check this out",
                url: fullPath
            });
        }

        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(fullPath);
        }
    }, []);

    function playChannel() {
        document.querySelector<HTMLAnchorElement>(".playlistStartVideo")?.click();
    }

    const toggleDescOpen = () => setDescOpen((current) => !current);

    const { data: channelData, isLoading: isLoadingChannel } = useQuery({
        queryKey: [`channel-${channelId}`],
        queryFn: () => fetchFn<FetchChannelT>({
            route: `api/channels/${channelId}`,
            options: {
                method: "GET",
                headers
            }
        }),
        enabled: !!channelId
    });

    const { data: channelVideosData, isLoading: isLoadingVideos } = useQuery({
        queryKey: [`channel-videos-${channelId}`, !!token],
        queryFn: () => fetchFn<ChannelVideosT>({
            route: `api/channels/${channelId}/videos?sortBy=view_count&sortOrder=asc&page=1&limit=20`,
            options: {
                method: "GET",
                headers
            }
        }),
        enabled: !!channelId
    });

    const channel = channelData?.channel as ChannelT | undefined;
    const normalizedVideos = channelVideosData?.videos?.map((video) => ({
        ...video,
        progress_seconds: Number(video.progress_seconds ?? 0),
        percentage_watched: Number(video.percentage_watched ?? 0),
    })) ?? [];

    useEffect(() => {
        const descriptionElement = descriptionRef.current;
        if (!descriptionElement) return;

        let resizeObserver: ResizeObserver | null = null;

        const measureOverflow = () => {
            const hasOverflow = descriptionElement.scrollHeight > descriptionElement.clientHeight + 1;
            setHasDescriptionOverflow(hasOverflow);
        };

        measureOverflow();

        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(() => measureOverflow());
            resizeObserver.observe(descriptionElement);
        }

        window.addEventListener("resize", measureOverflow);

        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener("resize", measureOverflow);
        };
    }, [channel?.description, descOpen]);

    const videoArray = normalizedVideos.map((video, index) => (
        <Item key={video.id} props={video as VideoT} playlistIndex={index + 1} />
    ));

    const skeletonVideoArray = Array.from({ length: 8 }).map((_, index) => (
        <SkeletonVideoItem key={`channel-skeleton-video-${index}`} />
    ));

    if (isLoadingChannel || isLoadingVideos) {
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
                <img
                    className="plBanner w-50 rounded-[15px] z-1"
                    src={channel?.image_url || DefaultProfile}
                    alt={channel?.full_name || "Channel"}
                />

                <span className="flex flex-col gap-3 z-1 w-full">
                    <h2 className="subTitle pb-0!">{channel?.full_name}</h2>

                    <p className="mobileViewAndLikeCount -mb-1.25">
                        {t("videosLabel", { count: channelVideosData?.pagination?.total || normalizedVideos.length })}
                    </p>

                    <span className="buttonHolder">
                        <button className="play rounded-full! flex! bg-(--accentBlue)! text-white! font-semibold!" onClick={playChannel}>
                            {PlaySVG}&nbsp;{t("playAll")}
                        </button>

                        <button onClick={shareChannelLink} className="clickable bg-(--background2) hover:bg-(--background3) rounded-full flex">
                            {ShareSVG}&nbsp;{t("share")}
                        </button>
                    </span>

                    <p ref={descriptionRef} className={`description ${descOpen ? "open" : ""}`}>{formatDescription(channel?.description)}</p>
                    {channel?.description && hasDescriptionOverflow && (
                        <button className="w-fit hover:underline cursor-pointer" onClick={toggleDescOpen}>
                            {descOpen ? t("readLess") : t("readMore")}
                        </button>
                    )}
                </span>
            </div>

            <div className="videoHolder">{videoArray}</div>

            {normalizedVideos.length === 0 && (
                <p className="noVideosMessage">{t("noVideosInPlaylist")}</p>
            )}
        </main>
    );
}

export default ChannelPage;
