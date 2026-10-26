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
    id: string;
    user_id: string;
    quiz_id: string;
    quiz_title: string | null;
    quiz_attempt_id: string;
    certificate_template_id: string | null;
    certificate_number: string;
    status: 'issued' | 'revoked';
    issued_at: string;
    revoked_at: string | null;
    created_at: string;
};
export type CertificateDetail = Certificate & {
    data_snapshot: {
        user: { full_name: string };
        quiz: { title: string };
        result: { score_percentage: number; earned_points: number; max_points: number };
        certificate: { number: string; issued_at: string };
    };
    template_snapshot: import('../quizEngine/certificateApi').CertificateTemplateInput;
};
type CertificatesResponse = {
    success: boolean;
    certificates: Certificate[];
    pagination: { page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean };
};

export function accountCertificatesQuery(token: string | null | undefined) {
    return infiniteQueryOptions({
        queryKey: ['account-certificates', token],
        initialPageParam: 1,
        queryFn: ({ signal, pageParam }) => fetchFn<CertificatesResponse>({
            route: `api/certificates?page=${pageParam}&limit=${limit}&sortBy=issued_at&sortOrder=desc`,
            options: { headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store' },
        }),
        getNextPageParam: (last, pages, page) => nextResultsPage(last, pages, page, limit, response => response.certificates),
        enabled: !!token,
        staleTime: 0,
    });
}

export function accountCertificateQuery(token: string | null | undefined, id: string | null) {
    return queryOptions({
        queryKey: ['account-certificate', token, id],
        queryFn: ({ signal }) => fetchFn<{ success: boolean; certificate: CertificateDetail }>({
            route: `api/certificates/${encodeURIComponent(id!)}`,
            options: { headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store' },
        }),
        enabled: !!token && !!id,
        staleTime: 0,
    });
}

// Verification links and QR scans must also work for visitors without a session.
export function publicCertificateQuery(id: string | undefined) {
    return queryOptions({
        queryKey: ['public-certificate', id],
        queryFn: ({ signal }) => fetchFn<{ success: boolean; certificate: CertificateDetail }>({
            route: `api/certificates/${encodeURIComponent(id!)}`,
            options: { signal, cache: 'no-store' },
            handleUnauthorizedLocally: true,
        }),
        enabled: !!id,
        staleTime: 0,
        retry: (count, error) => {
            const status = (error as Error & { status?: number }).status;
            return status !== 400 && status !== 404 && count < 1;
        },
    });
}
