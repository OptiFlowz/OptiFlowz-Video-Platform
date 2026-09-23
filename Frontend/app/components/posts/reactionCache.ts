import type { QueryClient, InfiniteData } from '@tanstack/react-query';
import type { Post, PostReaction } from './model';

// Match only this viewer's feeds; reactions must not leak across sessions.
export function postFeedFilter(token: string | null) {
  return { queryKey: ['posts'], predicate: (query: { queryKey: readonly unknown[] }) =>
    (query.queryKey[1] === 'recommended' && query.queryKey[2] === token)
    || (query.queryKey[1] === 'channel' && query.queryKey[3] === token) };
}

export function updatePostReaction(client: QueryClient, id: string, token: string | null, reaction: PostReaction) {
  type Feed = { posts: Post[] };
  const update = (feed: Feed): Feed => ({ ...feed, posts: feed.posts.map(post => post.id === id ? { ...post, ...reaction } : post) });
  client.setQueriesData<Feed | InfiniteData<Feed>>(postFeedFilter(token), data => {
    if (!data) return data;
    return 'pages' in data ? { ...data, pages: data.pages.map(update) } : update(data);
  });
}
