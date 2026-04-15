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

type ChannelSortBy = "view_count" | "created_at";
type ChannelSortOrder = "asc" | "desc";

const CHANNEL_SORT_OPTIONS: Array<{
    value: `${ChannelSortBy}:${ChannelSortOrder}`;
    label: string;
}> = [
    { value: "view_count:asc", label: "Views: Low to High" },
    { value: "view_count:desc", label: "Views: High to Low" },
    { value: "created_at:desc", label: "Date: Newest First" },
    { value: "created_at:asc", label: "Date: Oldest First" },
];

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
    const [sortBy, setSortBy] = useState<ChannelSortBy>("created_at");
    const [sortOrder, setSortOrder] = useState<ChannelSortOrder>("desc");
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
        queryKey: [`channel-videos-${channelId}`, !!token, sortBy, sortOrder],
        queryFn: () => fetchFn<ChannelVideosT>({
            route: `api/channels/${channelId}/videos?sortBy=${sortBy}&sortOrder=${sortOrder}&page=1&limit=20`,
            options: {
                method: "GET",
                headers
            }
        }),
        enabled: !!channelId,
        placeholderData: (previousData) => previousData
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

    const videoArray = normalizedVideos.map((video) => (
        <Item key={video.id} props={video as VideoT} />
    ));

    const skeletonVideoArray = Array.from({ length: 8 }).map((_, index) => (
        <SkeletonVideoItem key={`channel-skeleton-video-${index}`} />
    ));

    const handleSortChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const [nextSortBy, nextSortOrder] = event.target.value.split(":") as [ChannelSortBy, ChannelSortOrder];
        setSortBy(nextSortBy);
        setSortOrder(nextSortOrder);
    };

    if ((isLoadingChannel && !channelData) || (isLoadingVideos && !channelVideosData)) {
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

            <div className="channelVideosHeader">
                <h3 className="channelVideosTitle">{t("videosTab")}</h3>
                <select
                    aria-label="Sort videos"
                    id="channel-sort-select"
                    value={`${sortBy}:${sortOrder}`}
                    onChange={handleSortChange}
                >
                    {CHANNEL_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className="videoHolder">{videoArray}</div>

            {normalizedVideos.length === 0 && (
                <p className="noVideosMessage">{t("noVideosInPlaylist")}</p>
            )}
        </main>
    );
}

export default ChannelPage;
