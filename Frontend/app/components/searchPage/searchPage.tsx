import { getVideoThumbnail } from "~/components/shared/videoMedia";
import { useParams, useSearchParams, useNavigate, Link } from "react-router";
import { useState, useMemo, useEffect, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import type { SearchT, PlaylistSearchRes, PeopleSearchRes } from "~/types";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";
import CustomSelect from "~/components/customSelect/customSelect";
import Pagination from "~/components/library/pagination";
import SearchResultCard, { type SearchResult } from "./searchResultCard";
import { SearchIcon } from "./searchIcons";
import styles from "./searchPage.module.css";
import backgroundImage from "../../../assets/LoginBackground.webp";

type SearchContext = { query: string; category: string | null; tag: string | null; person: string | null; label: string };

function SearchResults({ context }: { context: SearchContext }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [token, setToken] = useState<string>();
  const [input, setInput] = useState(context.label);
  const [selected, setSelected] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [sort, setSort] = useState("relevance");
  const choseCategory = useRef(false);
  useEffect(() => { setToken(getToken() || undefined); }, []);
  const headers = useMemo(() => new Headers(token ? { Authorization: `Bearer ${token}` } : {}), [token]);
  const hasSearch = !!(context.query || context.category || context.tag || context.person);
  const videoParams = new URLSearchParams();
  if (context.category) videoParams.set("category", context.category);
  else if (context.tag) videoParams.set("tags", context.tag);
  else if (context.person) videoParams.set("person", context.person);
  else videoParams.set("q", context.query);
  videoParams.set("page", String(selected === 0 ? page : 1));
  videoParams.set("limit", String(limit));
  videoParams.set("sort", sort);
  const videoRoute = `api/videos/search?${videoParams}`;
  const playlistRoute = `api/playlists/search?${new URLSearchParams({ q: context.label, page: String(selected === 1 ? page : 1), limit: String(limit), sort })}`;
  const peopleRoute = `api/people/search?${new URLSearchParams({ q: context.label, page: String(selected === 2 ? page : 1), limit: String(limit) })}`;

  const [videoQ, playlistQ, peopleQ] = useQueries({ queries: [
    {
      queryKey: ["search-videos", token, videoRoute],
      queryFn: ({ signal }) => fetchFn<SearchT>({ route: videoRoute, options: { headers, signal } }),
      enabled: !!token && hasSearch,
      refetchOnWindowFocus: false,
    },
    {
      queryKey: ["search-playlists", token, playlistRoute],
      queryFn: ({ signal }) => fetchFn<PlaylistSearchRes>({ route: playlistRoute, options: { headers, signal } }),
      enabled: !!token && !!context.label,
      refetchOnWindowFocus: false,
    },
    {
      queryKey: ["search-people", token, peopleRoute],
      queryFn: ({ signal }) => fetchFn<PeopleSearchRes>({ route: peopleRoute, options: { headers, signal } }),
      enabled: !!token && !!context.label,
      refetchOnWindowFocus: false,
    },
  ] });
  const queries = [videoQ, playlistQ, peopleQ];
  const counts = [
    videoQ.data?.pagination?.total ?? videoQ.data?.videos?.length,
    playlistQ.data?.pagination?.total ?? playlistQ.data?.playlists?.length,
    peopleQ.data?.pagination?.total ?? peopleQ.data?.people?.length,
  ];
  const activeQuery = queries[selected];
  const total = counts[selected] ?? 0;
  const fetching = hasSearch && (!token || activeQuery.isLoading);
  const initialLoading = hasSearch && (!token || queries.some((query) => query.isLoading));
  const allCountsKnown = counts.every((count) => count !== undefined);
  const resultCount = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  const tabs = [
    { label: t("videosTab"), description: t("searchVideosHint"), icon: "video" as const },
    { label: t("playlistsTab"), description: t("searchPlaylistsHint"), icon: "playlist" as const },
    { label: t("contributorsTab"), description: t("searchPeopleHint"), icon: "people" as const },
  ];

  useEffect(() => {
    if (initialLoading || choseCategory.current || !hasSearch) return;
    const available = counts.findIndex((count) => (count ?? 0) > 0);
    if (available >= 0) {
      setSelected(available);
      choseCategory.current = true;
    }
  }, [initialLoading, hasSearch, counts[0], counts[1], counts[2]]);

  useEffect(() => {
    if (activeQuery.data && !activeQuery.isFetching && page > Math.max(1, Math.ceil(total / limit))) {
      setPage(Math.max(1, Math.ceil(total / limit)));
    }
  }, [activeQuery.data, activeQuery.isFetching, page, total, limit]);

  const results: SearchResult[] = selected === 0
    ? (videoQ.data?.videos ?? []).map((video) => ({
        id: video.id, kind: "video", title: video.title, href: `/video/${video.id}`,
        thumbnail: getVideoThumbnail(video), preview_url: video.preview_url, author: video.people?.map((person) => person.name).join(", ") || video.uploader_name,
        views: video.view_count, date: video.created_at, duration: video.duration_seconds, progress: video.percentage_watched,
      }))
    : selected === 1 ? (playlistQ.data?.playlists ?? []).map((playlist) => ({
        id: playlist.id, kind: "playlist", title: playlist.title, href: `/playlist/${playlist.id}`,
        thumbnail: playlist.thumbnail_url, description: playlist.description || "",
        views: playlist.view_count, date: playlist.created_at, videoCount: playlist.video_count,
      }))
    : (peopleQ.data?.people ?? []).map((person) => ({
        id: person.id, kind: "people", title: person.name,
        href: `/search?${new URLSearchParams({ person: person.id, name: person.name })}`,
        thumbnail: person.image_url, description: person.description || t("noBioPerson"), videoCount: Number(person.total_video_count),
      }));

  const contextTitle = context.category ? "categoryResultsFor" : context.tag ? "tagResultsFor" : context.person ? "personResultsFor" : "searchResultsFor";

  return (
    <main className={styles.page}>
      <section className={styles.intro} aria-labelledby="search-heading">
        <div className={styles.introBackground} aria-hidden="true">
          <img src={backgroundImage} alt="" />
        </div>
        <div className={styles.introContent}>
        <div className={styles.headingRow}>
          <div>
            <h1 id="search-heading">{hasSearch ? t(contextTitle, { value: context.label }) : t("searchLibraryTitle")}</h1>
            <p className={styles.subtitle}>{t("searchLibrarySubtitle")}</p>
          </div>
          {hasSearch && allCountsKnown ? <div className={styles.totalBadge}><SearchIcon name="search" /><span>{t("searchResultCount", { count: resultCount })}</span></div> : null}
        </div>
        <form className={styles.searchForm} role="search" onSubmit={(event) => {
          event.preventDefault();
          if (input.trim()) navigate(`/search/${encodeURIComponent(input.trim())}`);
        }}>
          <SearchIcon name="search" />
          <label className={styles.srOnly} htmlFor="library-search">{t("searchAria")}</label>
          <input id="library-search" type="search" value={input} onChange={(event) => setInput(event.target.value)} placeholder={t("searchLibraryPlaceholder")} autoComplete="off" />
          <button type="submit" disabled={!input.trim()}>{t("search")}<SearchIcon name="search" /></button>
        </form>
        </div>
      </section>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <p className={styles.sidebarTitle}>{t("searchContentType")}</p>
          <nav className={styles.categories} aria-label={t("searchContentType")}>
            {tabs.map((tab, index) => (
              <button key={tab.icon} type="button" aria-pressed={selected === index} onClick={() => { choseCategory.current = true; setSelected(index); setPage(1); }}>
                <span className={styles.categoryIcon}><SearchIcon name={tab.icon} /></span>
                <span className={styles.categoryText}><strong>{tab.label}</strong><small>{tab.description}</small></span>
                <span className={styles.count}>{counts[index] ?? (!hasSearch || queries[index].isError ? "—" : "…")}</span>
              </button>
            ))}
          </nav>
          <div className={styles.browseCard}>
            <span className={styles.browseIcon}><SearchIcon name="playlist" /></span>
            <h2>{t("searchExploreTitle")}</h2>
            <p>{t("searchExploreText")}</p>
            <Link to="/">{t("searchExploreAction")}<SearchIcon name="arrow" /></Link>
          </div>
        </aside>

        <section className={styles.results} aria-labelledby="results-heading" aria-busy={fetching || activeQuery.isFetching}>
          <div className={styles.resultsToolbar}>
            <div><h2 id="results-heading">{tabs[selected].label}<span>{counts[selected] ?? "—"}</span></h2><p>{t("searchMatchingResults")}</p></div>
            {selected !== 2 && hasSearch ? <div className={styles.sort}><span>{t("searchSortBy")}</span><CustomSelect
              value={sort}
              onChange={(value) => { setSort(value); setPage(1); }}
              options={[{ value: "relevance", label: t("searchSortRelevance") }, { value: "date", label: t("searchSortNewest") }, { value: "views", label: t("searchSortViews") }]}
              ariaLabel={t("searchSortBy")}
              triggerClassName={styles.sortSelect}
            /></div> : null}
          </div>
          {!hasSearch ? (
            <div className={styles.empty}><SearchIcon name="search" /><h3>{t("searchLibraryTitle")}</h3><p>{t("searchLibrarySubtitle")}</p></div>
          ) : fetching ? (
            <div className={styles.resultList} aria-label={t("searchLoadingResults")}>
              {[0, 1, 2].map((item) => <div key={item} className={styles.skeleton} aria-hidden="true"><div /><span><i /><i /><i /></span></div>)}
            </div>
          ) : activeQuery.isError ? (
            <div className={styles.empty} role="alert"><SearchIcon name="search" /><h3>{t("searchLoadFailed")}</h3><p>{t("searchTryAgain")}</p><button type="button" onClick={() => void activeQuery.refetch()}>{t("usersRetry")}</button></div>
          ) : results.length ? (
            <div className={styles.resultList}>{results.map((result) => <SearchResultCard key={`${result.kind}-${result.id}`} result={result} />)}</div>
          ) : (
            <div className={styles.empty}><SearchIcon name="search" /><h3>{t("noResultsTitle")}</h3><p>{t("noResultsText")}</p><button type="button" onClick={() => { document.getElementById("library-search")?.focus(); }}>{t("searchChangeQuery")}</button></div>
          )}
          {hasSearch && activeQuery.data && !activeQuery.isError ? <Pagination
            page={page} limit={limit} total={total} loading={activeQuery.isFetching}
            label={tabs[selected].label} onPageChange={setPage} onLimitChange={(value) => { setLimit(value); setPage(1); }}
          /> : null}
        </section>
      </div>
    </main>
  );
}

export default function SearchPage() {
  const { searchValue = "" } = useParams();
  const [params] = useSearchParams();
  const category = params.get("category");
  const tag = params.get("tag");
  const person = params.get("person");
  const label = category ? params.get("title") || category : tag ? params.get("title") || tag : person ? params.get("name") || person : searchValue;
  const context = { query: searchValue, category, tag, person, label };
  return <SearchResults key={JSON.stringify(context)} context={context} />;
}
