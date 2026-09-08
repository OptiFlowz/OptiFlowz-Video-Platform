import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { fetchFn } from "~/API";
import type { VideoT } from "~/types";
import Item from "../itemSlider/item";
import Pagination from "~/components/library/pagination";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";
import { useRouter } from "next/navigation";
import { usePrivacyPreferences } from "~/privacy/privacyPreferences";

type VideoCollection = {
  videos: VideoT[];
  pagination?: { page: number; limit: number; total?: number; total_pages?: number };
};
const collections: Record<string, { route: string; title: string; requiresAuth: boolean }> = {
  "0": { route: "api/videos/user/continue", title: "continueWatching", requiresAuth: true },
  "1": { route: "api/videos/user/recommended", title: "recommendedForYou", requiresAuth: true },
  "2": { route: "api/videos/trending", title: "navTrending", requiresAuth: false },
  "3": { route: "api/videos/user/liked", title: "savedVideos", requiresAuth: true },
  "4": { route: "api/videos/user/history", title: "watchHistory", requiresAuth: true },
};

function VideoCollectionPage({ type }: { type: string }) {
  const { t } = useI18n();
  const { preferences, openPreferences } = usePrivacyPreferences();
  const token = getToken();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const collection = collections[type];
  const allowed = !!collection && (!collection.requiresAuth || !!token);
  const personalizationDisabled = type === "1" && !preferences.personalization;
  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: ["video-collection", token, type, page, limit],
    queryFn: ({ signal }) => fetchFn<VideoCollection>({
      route: `${collection.route}?${new URLSearchParams({ page: String(page), limit: String(limit) })}`,
      options: { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal },
    }),
    enabled: allowed && !personalizationDisabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!collection?.requiresAuth || token) return;
    const target = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    router.replace(`/login?redirect=${encodeURIComponent(target)}`);
  }, [collection, token, router]);

  if (!allowed) return null;
  return <main className="videos">
    <div className="heading"><h1 className="font-bold text-3xl max-[520px]:text-2xl mb-6">{t(collection.title)}</h1></div>
    {personalizationDisabled ? <div className="watchToRecommend">
      <p>{t("privacyPersonalizationDisabled")}</p>
      <button type="button" className="privacySettingsButton mt-4" onClick={openPreferences}>{t("privacyEnablePersonalization")}</button>
    </div> : <>
      {isError ? <div role="alert" className="platformUsersState">
        <p>{t("searchLoadFailed")}</p><button type="button" className="button" onClick={() => void refetch()}>{t("usersRetry")}</button>
      </div> : isPending ? <div className="holder collection mb-8" aria-busy="true">
        {Array.from({ length: 12 }, (_, index) => <div className="skeleton-item" key={index}><div className="skeleton-thumbnail" /><div className="skeleton-content"><div className="skeleton-title" /><div className="skeleton-text" /></div></div>)}
      </div> : data?.videos.length ? <div className="holder collection mb-8">
        {data.videos.map(video => <Item key={video.id} props={video} />)}
      </div> : <p className="platformUsersState">{t(type === "1" && page === 1 ? "watchSomeVideos" : "adminZeroResults")}</p>}
      <Pagination page={page} limit={limit} total={data?.pagination?.total} totalPages={data?.pagination?.total_pages}
        itemCount={data?.videos.length} hasNextPage={(data?.videos.length ?? 0) === limit}
        loading={isFetching || isPending} disabled={isError} label={t(collection.title)}
        onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
    </>}
  </main>;
}

export default function VideosPage() {
  const { type = "" } = useParams();
  return <VideoCollectionPage key={type} type={type} />;
}
