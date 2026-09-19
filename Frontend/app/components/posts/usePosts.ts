import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getToken } from '~/functions';
import { getMyPosts } from './api';
export function usePosts(channelId: string, page: number, limit: number, ascending: boolean, search: string) {
  const client = useQueryClient();
  const token = getToken();
  const query = useQuery({ queryKey: ['posts', 'my', channelId, token, page, limit, ascending, search], queryFn: ({ signal }) => getMyPosts(page, limit, ascending, search, signal), enabled: !!channelId, retry: false });
  const refresh = () => client.invalidateQueries({ queryKey: ['posts'] });
  return { posts: query.data?.posts ?? [], pagination: query.data?.pagination, refresh, loading: query.isPending, error: query.error };
}
