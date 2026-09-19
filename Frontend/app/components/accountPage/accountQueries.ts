import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import type { PlaylistVideoT, VideoPlaylistT } from "~/types";
import { nextResultsPage } from "../library/infiniteResults";

const routes = {
    4: 'api/videos/user/history',
    3: 'api/videos/user/liked',
    0: 'api/videos/user/continue',
    6: 'api/playlists/user/saved',
} as const;
type LibraryResponse = {
    videos?: PlaylistVideoT[];
    playlists?: VideoPlaylistT[];
    pagination?: { total?: number; totalPages?: number; total_pages?: number };
};

export type AccountLibraryType = keyof typeof routes;
const limit = 20;

export function accountLibraryQuery(type: AccountLibraryType, token: string | null | undefined) {
    return infiniteQueryOptions({
        queryKey: ['account-library-infinite', token, type, limit],
        initialPageParam: 1,
        queryFn: ({ signal, pageParam }) => {
            const params = new URLSearchParams({ limit: String(limit) });
            params.set(type === 6 ? 'offset' : 'page', String(type === 6 ? (pageParam - 1) * limit : pageParam));
            return fetchFn<LibraryResponse>({
                route: `${routes[type]}?${params}`,
                options: { headers: { Authorization: `Bearer ${token}` }, signal },
            });
        },
        getNextPageParam: (last, pages, page) => nextResultsPage(last, pages, page, limit,
            response => (type === 6 ? response.playlists : response.videos) ?? []),
        enabled: !!token,
        staleTime: 30_000,
    });
}

export type Certificate = {
    quiz_id: string;
    quiz_title: string;
    attempt_id: string;
    date_of_completion?: string | null;
};

export function accountCertificatesQuery(token: string | null | undefined) {
    return queryOptions({
        queryKey: ['quizCertificates', token],
        queryFn: ({ signal }) => fetchFn<{ success: boolean; certificates?: Certificate[] }>({
            route: 'api/quizzes/certificates',
            options: { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal },
        }),
        enabled: !!token,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    });
}
