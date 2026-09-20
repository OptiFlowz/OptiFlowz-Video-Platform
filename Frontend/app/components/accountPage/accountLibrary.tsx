import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";
import Item from "../itemSlider/item";
import PlaylistItem from "../itemSlider/playlistItem";
import InfiniteScroll from "../library/infiniteScroll";
import { uniqueResults } from "../library/infiniteResults";

import { accountLibraryQuery, type AccountLibraryType } from "./accountQueries";

const emptyMessages = {
    4: 'accountHistoryEmpty',
    3: 'accountLikedEmpty',
    0: 'accountContinueEmpty',
    6: 'accountPlaylistsEmpty',
} as const;

export default function AccountLibrary({ type }: { type: AccountLibraryType }) {
    const { t } = useI18n();
    const token = getToken();
    const { data, isPending, isFetching, isError, isFetchNextPageError, refetch, fetchNextPage, hasNextPage } = useInfiniteQuery(accountLibraryQuery(type, token));
    const videos = useMemo(() => uniqueResults(data?.pages.flatMap(page => page.videos ?? []) ?? []), [data]);
    const playlists = useMemo(() => uniqueResults(data?.pages.flatMap(page => page.playlists ?? []) ?? []), [data]);
    const count = type === 6 ? playlists.length : videos.length;
    const loadMore = useCallback(() => {
        if (isError && !isFetchNextPageError) void refetch();
        else void fetchNextPage({ cancelRefetch: false });
    }, [isError, isFetchNextPageError, refetch, fetchNextPage]);

    return <>
        {isError && !count ? <div className="platformUsersState" role="alert">
            <p>{t('searchLoadFailed')}</p>
            <button className="button" type="button" onClick={() => void refetch()}>{t('usersRetry')}</button>
        </div> : isPending ? <div className="collection accountLibraryGrid" aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => <div className="skeleton-item" key={index}>
                <div className="skeleton-thumbnail" /><div className="skeleton-content"><div className="skeleton-title" /><div className="skeleton-text" /></div>
            </div>)}
        </div> : count ? <div className="collection accountLibraryGrid">
            {type === 6 ? playlists.map(playlist => <PlaylistItem key={playlist.id} props={playlist} featured />)
                : videos.map(video => <Item key={video.id} props={video} />)}
        </div> : <p className="watchToRecommend">{t(emptyMessages[type])}</p>}
        {count > 0 && <InfiniteScroll
            hasMore={hasNextPage} fetching={isFetching} error={isError}
            onLoadMore={loadMore} loadingLabel={t('videoLoadingData')}
        />}
    </>;
}
