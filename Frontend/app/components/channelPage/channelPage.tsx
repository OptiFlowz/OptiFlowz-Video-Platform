import ChannelPosts from '../posts/ChannelPosts';
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, useEffect, useId } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { fetchFn } from "~/API";
import { ShareSVG } from "~/constants";
import { env } from "~/env";
import { formatDescription, getToken } from "~/functions";
import { useI18n } from "~/i18n";
import type { ChannelPlaylistsT, ChannelT, ChannelVideosT, FetchChannelT, VideoT, VideoPlaylistT } from "~/types";
import CustomSelect from "../customSelect/customSelect";
import Item from "../itemSlider/item";
import PlaylistItem from "../itemSlider/playlistItem";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import backgroundImage from "../../../assets/LoginBackground.webp";
import "./channelPage.css";

type ChannelSortBy = "view_count" | "created_at";
type ChannelSortOrder = "asc" | "desc";

const CHANNEL_SORT_OPTIONS: Array<{
    value: `${ChannelSortBy}:${ChannelSortOrder}`;
    label: string;
}> = [
    { value: "view_count:desc", label: "channelSortMostPopular" },
    { value: "created_at:desc", label: "channelSortNewest" },
    { value: "view_count:asc", label: "channelSortLeastPopular" },
    { value: "created_at:asc", label: "channelSortOldest" },
];

type ChannelSortValue = `${ChannelSortBy}:${ChannelSortOrder}`;

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
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const channelPath = `/channel/${encodeURIComponent(channelId || '')}`;
    const tabSegment = pathname.replace(/\/$/, '').split('/')[3];
    const activeTab = tabSegment === 'playlists' || tabSegment === 'posts' ? tabSegment : 'videos';
    const selectTab = (tab: 'videos' | 'playlists' | 'posts') => {
        if (tab === activeTab) return;
        navigate(tab === 'videos' ? channelPath : `${channelPath}/${tab}`, { preventScrollReset: true });
    };
    const [postAscending, setPostAscending] = useState(false);
    const tabsId = useId();
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [descOpen, setDescOpen] = useState(false);
    const [hasDescriptionOverflow, setHasDescriptionOverflow] = useState(false);
    const [videoSortBy, setVideoSortBy] = useState<ChannelSortBy>("created_at");
    const [videoSortOrder, setVideoSortOrder] = useState<ChannelSortOrder>("desc");
    const [playlistSortBy, setPlaylistSortBy] = useState<ChannelSortBy>("created_at");
    const [playlistSortOrder, setPlaylistSortOrder] = useState<ChannelSortOrder>("desc");
    const [descriptionElement, setDescriptionElement] = useState<HTMLParagraphElement | null>(null);
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

    const toggleDescOpen = () => setDescOpen((current) => !current);

    const { data: channelData, isLoading: isLoadingChannel } = useQuery({
        queryKey: [`channel-${channelId}`],
        queryFn: ({ signal }) => fetchFn<FetchChannelT>({
            route: `api/channels/${channelId}`,
            options: {
                method: "GET",
                headers, signal
            }
        }),
        enabled: !!channelId
    });

    const { data: channelVideosData, isLoading: isLoadingVideos } = useQuery({
        queryKey: [`channel-videos-${channelId}`, !!token, videoSortBy, videoSortOrder],
        queryFn: ({ signal }) => fetchFn<ChannelVideosT>({
            route: `api/channels/${channelId}/videos?sortBy=${videoSortBy}&sortOrder=${videoSortOrder}&page=1&limit=20`,
            options: {
                method: "GET",
                headers, signal
            }
        }),
        enabled: !!channelId && activeTab === "videos",
        staleTime: 30_000,
        placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[0] === `channel-videos-${channelId}` ? previousData : undefined
    });

    const { data: channelPlaylistsData, isLoading: isLoadingPlaylists } = useQuery({
        queryKey: [`channel-playlists-${channelId}`, !!token, playlistSortBy, playlistSortOrder],
        queryFn: ({ signal }) => fetchFn<ChannelPlaylistsT>({
            route: `api/channels/${channelId}/playlists?sortBy=${playlistSortBy}&sortOrder=${playlistSortOrder}`,
            options: {
                method: "GET",
                headers, signal
            }
        }),
        enabled: !!channelId && activeTab === "playlists",
        staleTime: 30_000,
        placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[0] === `channel-playlists-${channelId}` ? previousData : undefined
    });

    const { data: channelVideoCount } = useQuery({
        queryKey: ["channel-video-count", channelId, token],
        queryFn: ({ signal }) => fetchFn<ChannelVideosT>({
            route: `api/channels/${channelId}/videos?limit=1&page=1`,
            options: { method: "GET", headers, signal },
        }),
        enabled: !!channelId && activeTab !== "videos" && !channelVideosData,
        staleTime: 30_000,
    });
    const channel = channelData?.channel as ChannelT | undefined;
    const normalizedVideos = useMemo(() => channelVideosData?.videos?.map((video) => ({
        ...video,
        progress_seconds: Number(video.progress_seconds ?? 0),
        percentage_watched: Number(video.percentage_watched ?? 0),
    })) ?? [], [channelVideosData]);
    const normalizedPlaylists = channelPlaylistsData?.playlists ?? [];
    const videoCount = channelVideosData?.pagination?.total ?? channelVideoCount?.pagination?.total;

    useEffect(() => {
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
    }, [descriptionElement, channel?.description, descOpen]);

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

    const handleVideoSortChange = (value: ChannelSortValue) => {
        const [nextSortBy, nextSortOrder] = value.split(":") as [ChannelSortBy, ChannelSortOrder];
        setVideoSortBy(nextSortBy);
        setVideoSortOrder(nextSortOrder);
    };

    const handlePlaylistSortChange = (value: ChannelSortValue) => {
        const [nextSortBy, nextSortOrder] = value.split(":") as [ChannelSortBy, ChannelSortOrder];
        setPlaylistSortBy(nextSortBy);
        setPlaylistSortOrder(nextSortOrder);
    };

    if (isLoadingChannel && !channelData) {
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
        <main className="playlist channelPage">
            <div className="channelHero">
                <img className="channelHeroBackground" src={backgroundImage} alt="" aria-hidden="true" />
                <div className="channelHeroInner">
                    <img
                        className="channelAvatar"
                        src={channel?.image_url || DefaultProfile}
                        alt={channel?.full_name || t("channelLabel")}
                        onError={(event) => { event.currentTarget.src = DefaultProfile; }}
                    />
                    <div className="channelIdentity">
                        <div className="channelIdentityHeading">
                            <h1>{channel?.full_name}</h1>
                            <p className="channelVideoCount">{videoCount === undefined ? t("videosTab") : t("videosLabel", { count: videoCount })}</p>
                        </div>
                        {channel?.description && <div className="channelAbout">
                            <p ref={setDescriptionElement} className={`channelDescription ${descOpen ? "isExpanded" : ""}`}>{formatDescription(channel.description)}</p>
                            {(hasDescriptionOverflow || descOpen) && (
                                <button className="channelReadMore" onClick={toggleDescOpen} aria-expanded={descOpen}>
                                    {descOpen ? t("readLess") : t("readMore")}
                                </button>
                            )}
                        </div>}
                    </div>
                </div>
            </div>

            <div className="channelNavigation">
                <div className="channelTabs" role="tablist" aria-label={t("channelLabel")}>
                    {(["videos", "playlists", "posts"] as const).map((tab, index) => (
                        <button
                            key={tab}
                            ref={(element) => { tabRefs.current[index] = element; }}
                            id={`${tabsId}-${tab}-tab`}
                            role="tab"
                            type="button"
                            aria-selected={activeTab === tab}
                            aria-controls={`${tabsId}-${tab}-panel`}
                            tabIndex={activeTab === tab ? 0 : -1}
                            onClick={() => selectTab(tab)}
                            onKeyDown={(event) => {
                                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                                event.preventDefault();
                                const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : -1) + 3) % 3;
                                selectTab((["videos", "playlists", "posts"] as const)[next]);
                                tabRefs.current[next]?.focus();
                            }}
                        >{t(`${tab}Tab`)}</button>
                    ))}
                </div>
                <div className="channelSortControl">
                    {activeTab === 'posts' ? <CustomSelect value={postAscending ? 'asc' : 'desc'} options={[{value:'desc', label:t('channelSortNewest')}, {value:'asc', label:t('channelSortOldest')}]} onChange={value => setPostAscending(value === 'asc')} ariaLabel={t('searchSortBy')} rootClassName="channelSortSelect" /> : <CustomSelect
                        value={activeTab === "videos" ? `${videoSortBy}:${videoSortOrder}` : `${playlistSortBy}:${playlistSortOrder}`}
                        options={CHANNEL_SORT_OPTIONS.map(option => ({ ...option, label: t(option.label) }))}
                        onChange={(value) => activeTab === "videos"
                            ? handleVideoSortChange(value as ChannelSortValue)
                            : handlePlaylistSortChange(value as ChannelSortValue)}
                        ariaLabel={`${t("searchSortBy")}: ${t(activeTab === "videos" ? "videosTab" : "playlistsTab")}`}
                        rootClassName="channelSortSelect"
                    />}
                </div>
                <div className="channelActions">
                    <button type="button" onClick={shareChannelLink}>{ShareSVG}{t("share")}</button>
                </div>
            </div>

            <div className="channelPanel" role="tabpanel" id={`${tabsId}-videos-panel`} aria-labelledby={`${tabsId}-videos-tab`} hidden={activeTab !== "videos"} tabIndex={0}>
                {activeTab === "videos" && <><div className="videoHolder">{isLoadingVideos ? skeletonVideoArray : videoArray}</div>
                {!isLoadingVideos && normalizedVideos.length === 0 && <p className="channelEmpty">{t("channelAnalyticsBestVideosEmpty")}</p>}</>}
            </div>

            <div className="channelPanel" role="tabpanel" id={`${tabsId}-playlists-panel`} aria-labelledby={`${tabsId}-playlists-tab`} hidden={activeTab !== "playlists"} tabIndex={0}>
                {activeTab === "playlists" && <><div className="collection notscrollable channelPlaylistGrid">{isLoadingPlaylists ? skeletonPlaylistArray : playlistArray}</div>
                {!isLoadingPlaylists && normalizedPlaylists.length === 0 && <p className="channelEmpty">{t("quizNoPlaylistsFound")}</p>}</>}
            </div>
            <div className="channelPanel" role="tabpanel" id={`${tabsId}-posts-panel`} aria-labelledby={`${tabsId}-posts-tab`} hidden={activeTab !== 'posts'} tabIndex={0}>
                {activeTab === 'posts' && channel && <ChannelPosts channelId={channelId || ''} author={channel} videos={normalizedVideos} ascending={postAscending} />}
            </div>
        </main>
    );
}

export default ChannelPage;
