import InfiniteScroll from '../library/infiniteScroll';
import { nextResultsPage, uniqueResults } from '../library/infiniteResults';
import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import PublishedQuizList from "../quizEngine/PublishedQuizList";
import ChannelCollections from "../collections/ChannelCollections";
import ExpandableDescription from "../shared/ExpandableDescription";
import ChannelPosts from '../posts/ChannelPosts';
import { LiveList } from '../live/LiveList';
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, useId } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { fetchFn } from "~/API";
import { QuizSVG, CollectionsSVG, LiveSVG, ChannelMenuSVG, PlaylistSVG, PostSVG, ShareSVG } from "~/constants";
import { env } from "~/env";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";
import type { ChannelPlaylistsT, ChannelT, ChannelVideosT, FetchChannelT, VideoT, VideoPlaylistT } from "~/types";
import CustomSelect from "../customSelect/customSelect";
import Item from "../itemSlider/item";
import PlaylistItem from "../itemSlider/playlistItem";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import backgroundImage from "../../../assets/LoginBackground.webp";
import "./channelPage.css";
import ProfileTabs from "../library/ProfileTabs";

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
    const { can } = useAuthorization();
    const canParticipate = can(P.quizzesParticipate);
    const tabs = (["videos", "live", "playlists", "collections", "posts", "quizzes"] as const).filter(tab => tab !== "quizzes" || canParticipate);
    const { id: channelId } = useParams();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const channelPath = `/channel/${encodeURIComponent(channelId || '')}`;
    const tabSegment = pathname.replace(/\/$/, '').split('/')[3];
    const activeTab = (tabSegment === 'quizzes' && canParticipate) || tabSegment === 'collections' || tabSegment === 'playlists' || tabSegment === 'posts' || tabSegment === 'live' ? tabSegment : 'videos';
    const selectTab = (tab: 'videos' | 'playlists' | 'collections' | 'posts' | 'live' | 'quizzes') => {
        if (tab === activeTab) return;
        navigate(tab === 'videos' ? channelPath : `${channelPath}/${tab}`, { preventScrollReset: true, shallow: true });
    };
    const [quizSortOrder, setQuizSortOrder] = useState<ChannelSortOrder>('desc');
    const [collectionSortOrder, setCollectionSortOrder] = useState<ChannelSortOrder>('desc');
    const [postAscending, setPostAscending] = useState(false);
    const [liveSort, setLiveSort] = useState('streamed_at:desc');
    const tabsId = useId();
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [videoSortBy, setVideoSortBy] = useState<ChannelSortBy>("created_at");
    const [videoSortOrder, setVideoSortOrder] = useState<ChannelSortOrder>("desc");
    const [playlistSortBy, setPlaylistSortBy] = useState<ChannelSortBy>("created_at");
    const [playlistSortOrder, setPlaylistSortOrder] = useState<ChannelSortOrder>("desc");
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

    const videoQuery = useInfiniteQuery({
        queryKey: [`channel-videos-${channelId}`, token, videoSortBy, videoSortOrder],
        initialPageParam: 1,
        queryFn: ({ pageParam, signal }) => fetchFn<ChannelVideosT>({
            route: `api/channels/${channelId}/videos?sortBy=${videoSortBy}&sortOrder=${videoSortOrder}&page=${pageParam}&limit=20`,
            options: {
                method: "GET",
                headers, signal
            }
        }),
        enabled: !!channelId && activeTab === "videos",
        staleTime: 30_000,
        getNextPageParam: (page, pages, pageParam) => nextResultsPage(page, pages, pageParam, 20, data => data.videos)
    });

    const playlistQuery = useInfiniteQuery({
        queryKey: [`channel-playlists-${channelId}`, token, playlistSortBy, playlistSortOrder],
        initialPageParam: 1,
        queryFn: ({ pageParam, signal }) => fetchFn<ChannelPlaylistsT>({
            route: `api/channels/${channelId}/playlists?sortBy=${playlistSortBy}&sortOrder=${playlistSortOrder}&page=${pageParam}&limit=20`,
            options: {
                method: "GET",
                headers, signal
            }
        }),
        enabled: !!channelId && activeTab === "playlists",
        staleTime: 30_000,
        getNextPageParam: (page, pages, pageParam) => nextResultsPage(page, pages, pageParam, 20, data => data.playlists)
    });

    const channelVideosData = videoQuery.data;
    const channelPlaylistsData = playlistQuery.data;
    const isLoadingVideos = videoQuery.isLoading;
    const isLoadingPlaylists = playlistQuery.isLoading;

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
    const normalizedVideos = useMemo(() => uniqueResults(channelVideosData?.pages.flatMap(page => page.videos) ?? []).map((video) => ({
        ...video,
        progress_seconds: Number(video.progress_seconds ?? 0),
        percentage_watched: Number(video.percentage_watched ?? 0),
    })), [channelVideosData]);
    const normalizedPlaylists = uniqueResults(channelPlaylistsData?.pages.flatMap(page => page.playlists) ?? []);
    const videoCount = channelVideosData?.pages[0]?.pagination?.total ?? channelVideoCount?.pagination?.total;

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
                            <ExpandableDescription key={channelId} text={channel.description} />
                        </div>}
                    </div>
                </div>
            </div>

            <div className="channelNavigation">
                <ProfileTabs className="channelTabs" label={t("channelLabel")}>
                    {tabs.map((tab, index) => (
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
                                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                                selectTab(tabs[next]);
                                tabRefs.current[next]?.focus();
                                tabRefs.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
                            }}
                        ><span className={`profileTabIcon${tab === "posts" ? " profileTabIcon--posts" : ""}`} aria-hidden="true">{tab === "quizzes" ? QuizSVG : tab === "live" ? LiveSVG : tab === "videos" ? ChannelMenuSVG : tab === "playlists" ? PlaylistSVG : tab === "collections" ? CollectionsSVG : PostSVG}</span><span>{t(tab === "quizzes" ? "navQuizzes" : tab === "live" ? "liveTitle" : `${tab}Tab`)}</span></button>
                    ))}
                </ProfileTabs>
                <div className="channelSortControl">
                    {activeTab === 'quizzes' || activeTab === 'collections' ? <CustomSelect
                        value={activeTab === 'quizzes' ? quizSortOrder : collectionSortOrder}
                        onChange={value => (activeTab === 'quizzes' ? setQuizSortOrder : setCollectionSortOrder)(value as ChannelSortOrder)}
                        ariaLabel={t('searchSortBy')} rootClassName="channelSortSelect" options={[
                            { value: 'desc', label: t('channelSortNewest') },
                            { value: 'asc', label: t('channelSortOldest') },
                        ]} /> : activeTab === 'live' ? <CustomSelect value={liveSort} onChange={setLiveSort} ariaLabel={t('searchSortBy')} rootClassName="channelSortSelect" options={[
                        { value: 'streamed_at:desc', label: t('channelSortNewest') },
                        { value: 'streamed_at:asc', label: t('channelSortOldest') },
                        { value: 'views:desc', label: t('channelSortMostPopular') },
                        { value: 'views:asc', label: t('channelSortLeastPopular') },
                    ]} /> : activeTab === 'posts' ? <CustomSelect value={postAscending ? 'asc' : 'desc'} options={[{value:'desc', label:t('channelSortNewest')}, {value:'asc', label:t('channelSortOldest')}]} onChange={value => setPostAscending(value === 'asc')} ariaLabel={t('searchSortBy')} rootClassName="channelSortSelect" /> : <CustomSelect
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
                {!isLoadingVideos && !videoQuery.isError && normalizedVideos.length === 0 && <p className="channelEmpty">{t("channelAnalyticsBestVideosEmpty")}</p>}
                <InfiniteScroll hasMore={videoQuery.hasNextPage} fetching={videoQuery.isFetchingNextPage}
                    error={videoQuery.isError} loadingLabel={t('videoLoadingData')}
                    onLoadMore={() => void (videoQuery.isFetchNextPageError || videoQuery.hasNextPage ? videoQuery.fetchNextPage() : videoQuery.refetch())} /></>}
            </div>

            <div className="channelPanel" role="tabpanel" id={`${tabsId}-playlists-panel`} aria-labelledby={`${tabsId}-playlists-tab`} hidden={activeTab !== "playlists"} tabIndex={0}>
                {activeTab === "playlists" && <><div className="collection notscrollable channelPlaylistGrid">{isLoadingPlaylists ? skeletonPlaylistArray : playlistArray}</div>
                {!isLoadingPlaylists && !playlistQuery.isError && normalizedPlaylists.length === 0 && <p className="channelEmpty">{t("quizNoPlaylistsFound")}</p>}
                <InfiniteScroll hasMore={playlistQuery.hasNextPage} fetching={playlistQuery.isFetchingNextPage}
                    error={playlistQuery.isError} loadingLabel={t('videoLoadingData')}
                    onLoadMore={() => void (playlistQuery.isFetchNextPageError || playlistQuery.hasNextPage ? playlistQuery.fetchNextPage() : playlistQuery.refetch())} /></>}
            </div>
            <div className="channelPanel" role="tabpanel" id={`${tabsId}-live-panel`} aria-labelledby={`${tabsId}-live-tab`} hidden={activeTab !== 'live'} tabIndex={0}>
                {channelId && <LiveList key={channelId} channelId={channelId} sort={liveSort} active={activeTab === 'live'} />}
            </div>
            <div className="channelPanel" role="tabpanel" id={`${tabsId}-collections-panel`} aria-labelledby={`${tabsId}-collections-tab`} hidden={activeTab !== "collections"} tabIndex={0}>
                {activeTab === "collections" && channelId && <ChannelCollections key={channelId} channelId={channelId} sortOrder={collectionSortOrder} />}
            </div>
            <div className="channelPanel" role="tabpanel" id={`${tabsId}-posts-panel`} aria-labelledby={`${tabsId}-posts-tab`} hidden={activeTab !== 'posts'} tabIndex={0}>
                {activeTab === 'posts' && channel && <ChannelPosts channelId={channelId || ''} author={channel} videos={normalizedVideos} ascending={postAscending} />}
            </div>
            {canParticipate && <div className="channelPanel" role="tabpanel" id={`${tabsId}-quizzes-panel`} aria-labelledby={`${tabsId}-quizzes-tab`} hidden={activeTab !== 'quizzes'} tabIndex={0}>
                {activeTab === 'quizzes' && channelId && <PublishedQuizList key={channelId} userId={channelId} sortOrder={quizSortOrder} />}
            </div>}
        </main>
    );
}

export default ChannelPage;
