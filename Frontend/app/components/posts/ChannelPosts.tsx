import { useInfiniteQuery } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import type { ChannelVideoT } from '~/types';
import type { PostAuthor } from './model';
import { getChannelPosts } from './api';
import PostCard from './PostCard';
export default function ChannelPosts({ channelId, author, videos, ascending }: { channelId: string; author: PostAuthor; videos: ChannelVideoT[]; ascending: boolean }) {
  const { t } = useI18n();
  const query = useInfiniteQuery({ queryKey: ['posts', 'channel', channelId, getToken(), ascending], initialPageParam: 1, enabled: !!channelId,
    queryFn: ({ pageParam, signal }) => getChannelPosts(channelId, pageParam, ascending, signal),
    getNextPageParam: data => data.pagination.hasNextPage ? data.pagination.page + 1 : undefined, retry: false });
  const posts = query.data?.pages.flatMap(page => page.posts) ?? [];
  return <div className="channelPostsFeed" aria-busy={query.isFetching}>
    {query.isPending && <p role="status">{t('postLoading')}</p>}
    {query.isError && <p role="alert" className="postError">{t('postLoadError')} <button type="button" className="postSecondary" onClick={() => void query.refetch()}>{t('postRetry')}</button></p>}
    {!query.isPending && !query.isError && !posts.length && <p>{t('postEmpty')}</p>}
    {posts.map(post => <PostCard key={post.id} post={post} author={author} videos={videos} interactive />)}
    {query.hasNextPage && <button type="button" className="postSecondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t('postLoadMore')}</button>}
  </div>;
}
