import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useParams } from "react-router";
import { fetchFn } from "~/API";
import { PlaySVG, ShareSVG } from "~/constants";
import { env } from "~/env";
import { formatDescription, getToken } from "~/functions";
import { useI18n } from "~/i18n";
import type { ChannelPlaylistsT, ChannelT, ChannelVideosT, FetchChannelT, VideoT, VideoPlaylistT } from "~/types";
import Item from "../itemSlider/item";
import PlaylistItem from "../itemSlider/playlistItem";
import DefaultProfile from "../../../assets/DefaultProfile.webp";

type ChannelSortBy = "view_count" | "created_at";
type ChannelSortOrder = "asc" | "desc";

const CHANNEL_SORT_OPTIONS: Array<{
    value: `${ChannelSortBy}:${ChannelSortOrder}`;
    label: string;
}> = [
    { value: "view_count:desc", label: "Most Popular" },
    { value: "created_at:desc", label: "Newest" },
    { value: "view_count:asc", label: "Least Popular" },
    { value: "created_at:asc", label: "Oldest" },
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
    const [videoSortBy, setVideoSortBy] = useState<ChannelSortBy>("created_at");
    const [videoSortOrder, setVideoSortOrder] = useState<ChannelSortOrder>("desc");
    const [playlistSortBy, setPlaylistSortBy] = useState<ChannelSortBy>("created_at");
    const [playlistSortOrder, setPlaylistSortOrder] = useState<ChannelSortOrder>("desc");
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
        queryKey: [`channel-videos-${channelId}`, !!token, videoSortBy, videoSortOrder],
        queryFn: () => fetchFn<ChannelVideosT>({
            route: `api/channels/${channelId}/videos?sortBy=${videoSortBy}&sortOrder=${videoSortOrder}&page=1&limit=20`,
            options: {
                method: "GET",
                headers
            }
        }),
        enabled: !!channelId,
        placeholderData: (previousData) => previousData
    });

    const { data: channelPlaylistsData, isLoading: isLoadingPlaylists } = useQuery({
        queryKey: [`channel-playlists-${channelId}`, !!token, playlistSortBy, playlistSortOrder],
        queryFn: () => fetchFn<ChannelPlaylistsT>({
            route: `api/channels/${channelId}/playlists?sortBy=${playlistSortBy}&sortOrder=${playlistSortOrder}`,
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
    const normalizedPlaylists = channelPlaylistsData?.playlists ?? [];

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
    const playlistArray = normalizedPlaylists.map((playlist) => (
        <PlaylistItem key={playlist.id} props={playlist as VideoPlaylistT} featured={true} />
    ));

    const skeletonVideoArray = Array.from({ length: 8 }).map((_, index) => (
        <SkeletonVideoItem key={`channel-skeleton-video-${index}`} />
    ));
    const skeletonPlaylistArray = Array.from({ length: 3 }).map((_, index) => (
        <div className="item playlistItem featured" key={`channel-skeleton-playlist-${index}`}>
            <SkeletonVideoItem />
        </div>
    ));

    const handleVideoSortChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const [nextSortBy, nextSortOrder] = event.target.value.split(":") as [ChannelSortBy, ChannelSortOrder];
        setVideoSortBy(nextSortBy);
        setVideoSortOrder(nextSortOrder);
    };

    const handlePlaylistSortChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const [nextSortBy, nextSortOrder] = event.target.value.split(":") as [ChannelSortBy, ChannelSortOrder];
        setPlaylistSortBy(nextSortBy);
        setPlaylistSortOrder(nextSortOrder);
    };

    if ((isLoadingChannel && !channelData) || (isLoadingVideos && !channelVideosData) || (isLoadingPlaylists && !channelPlaylistsData)) {
        return (
            <main className="playlist">
                <SkeletonHeader />
                <div className="videoHolder">{skeletonVideoArray}</div>
                <div className="channelPlaylistsSection">
                    <div className="collection notscrollable">{skeletonPlaylistArray}</div>
                </div>
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
                    value={`${videoSortBy}:${videoSortOrder}`}
                    onChange={handleVideoSortChange}
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

            {normalizedPlaylists.length > 0 && (
                <section className="channelPlaylistsSection">
                    <div className="channelVideosHeader">
                        <h3 className="channelVideosTitle">{t("playlistsTab")}</h3>
                        <select
                            aria-label="Sort playlists"
                            id="channel-playlists-sort-select"
                            value={`${playlistSortBy}:${playlistSortOrder}`}
                            onChange={handlePlaylistSortChange}
                        >
                            {CHANNEL_SORT_OPTIONS.map((option) => (
                                <option key={`playlists-${option.value}`} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="collection notscrollable">{playlistArray}</div>
                </section>
            )}
        </main>
    );
}

export default ChannelPage;
