import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchFn } from '~/API';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import type { ChannelVideoT, ChannelVideosT } from '~/types';
import type { PostAuthor } from './model';
import { getChannelPosts } from './api';
import PostCard from './PostCard';
export default function ChannelPosts({ channelId, author, videos, ascending }: { channelId: string; author: PostAuthor; videos: ChannelVideoT[]; ascending: boolean }) {
  const { t } = useI18n();
  const query = useInfiniteQuery({ queryKey: ['posts', 'channel', channelId, getToken(), ascending], initialPageParam: 1, enabled: !!channelId,
    queryFn: ({ pageParam, signal }) => getChannelPosts(channelId, pageParam, ascending, signal),
    getNextPageParam: data => data.pagination.hasNextPage ? data.pagination.page + 1 : undefined, retry: false });
  const posts = useMemo(() => query.data?.pages.flatMap(page => page.posts) ?? [], [query.data]);
  // Modern responses hydrate embedded videos. Only old responses need the
  // channel's video list as a fallback, so opening posts need not preload it.
  const needsVideoFallback = posts.some(post => post.blocks.some(block =>
    block.type === 'video' && block.video === undefined && !videos.some(video => video.id === block.videoId)));
  const token = getToken();
  const fallback = useQuery({
    queryKey: ['channel-post-video-fallback', channelId, token],
    queryFn: ({ signal }) => fetchFn<ChannelVideosT>({
      route: `api/channels/${channelId}/videos?sortBy=created_at&sortOrder=desc&page=1&limit=20`,
      options: { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal },
    }),
    enabled: needsVideoFallback, staleTime: 30_000,
  });
  const embeddedVideos = useMemo(() => Array.from(new Map(
    [...videos, ...(fallback.data?.videos ?? [])].map(video => [video.id, video]),
  ).values()), [videos, fallback.data]);
  return <div className="channelPostsFeed" aria-busy={query.isFetching}>
    {query.isPending && <p role="status">{t('postLoading')}</p>}
    {query.isError && <p role="alert" className="postError">{t('postLoadError')} <button type="button" className="postSecondary" onClick={() => void query.refetch()}>{t('postRetry')}</button></p>}
    {!query.isPending && !query.isError && !posts.length && <p>{t('postEmpty')}</p>}
    {posts.map(post => <PostCard key={post.id} post={post} author={author} videos={embeddedVideos} interactive sideComments />)}
    {query.hasNextPage && <button type="button" className="postSecondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t('postLoadMore')}</button>}
  </div>;
}
