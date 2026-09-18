import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { fetchFn } from "~/API";
import { ShareSVG } from "~/constants";
import { PLATFORM_NAME } from "~/changeables";
import { formatDescription, getToken } from "~/functions";
import { useI18n } from "~/i18n";
import type { SearchT } from "~/types";
import CustomSelect from "../customSelect/customSelect";
import Item from "../itemSlider/item";
import InfiniteScroll from "../library/infiniteScroll";
import { nextResultsPage, uniqueResults } from "../library/infiniteResults";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import "./personPage.css";

export type PersonResponse = {
  person: { id: string; name: string; description: string | null; image_url: string | null };
};

type PersonVideosResponse = {
  videos: SearchT["videos"];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

const isPersonId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

function PersonProfile({ id }: { id: string }) {
  const { t } = useI18n();
  const token = getToken();
  const headers = useMemo(() => new Headers(token ? { Authorization: `Bearer ${token}` } : {}), [token]);
  const limit = 12;
  const [sort, setSort] = useState("date");
  const [descOpen, setDescOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [description, setDescription] = useState<HTMLParagraphElement | null>(null);
  const [shareStatus, setShareStatus] = useState("");
  const validId = isPersonId(id);
  const personQuery = useQuery({
    queryKey: ["person-profile", id, token],
    queryFn: ({ signal }) => fetchFn<PersonResponse>({ route: `api/people/${encodeURIComponent(id)}`, options: { headers, signal } }),
    enabled: validId,
    retry: (count, error) => (error as { status?: number }).status !== 404 && count < 2,
  });
  const person = personQuery.data?.person;
  const params = new URLSearchParams({ person: id, limit: String(limit), sort });
  const videoQuery = useInfiniteQuery({
    queryKey: ["person-videos-infinite", id, token, sort],
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) => fetchFn<PersonVideosResponse>({
      route: `api/videos/search?${params}&page=${pageParam}`, options: { headers, signal },
    }),
    getNextPageParam: (last, pages, page) => nextResultsPage(last, pages, page, limit, response => response.videos),
    enabled: validId && !!person,
    refetchOnWindowFocus: false,
  });
  const videos = uniqueResults(videoQuery.data?.pages.flatMap(page => page.videos) ?? []);
  const total = videoQuery.data?.pages[0]?.pagination.total;
  const { fetchNextPage, refetch, isError, isFetchNextPageError } = videoQuery;
  const loadMore = useCallback(() => {
    if (isError && !isFetchNextPageError) void refetch();
    else void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage, refetch, isError, isFetchNextPageError]);

  useEffect(() => {
    if (person?.name) document.title = `${person.name} | ${PLATFORM_NAME}`;
  }, [person?.name]);

  useEffect(() => {
    if (!description) return;
    const measure = () => setOverflow(description.scrollHeight > description.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(description);
    return () => observer.disconnect();
  }, [description, person?.description, descOpen]);

  const share = async () => {
    setShareStatus("");
    try {
      const url = `${window.location.origin}/person/${encodeURIComponent(id)}`;
      if (navigator.share) await navigator.share({ title: person?.name, url });
      else {
        await navigator.clipboard.writeText(url);
        setShareStatus("personLinkCopied");
      }
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") setShareStatus("personShareFailed");
    }
  };

  if (!validId || personQuery.isError || (personQuery.isSuccess && !person)) {
    const missing = !validId || (personQuery.error as { status?: number } | null)?.status === 404 || personQuery.isSuccess;
    return <main className="personPage"><div className="personStatus" role="status">
      <h1>{t(missing ? "personNotFound" : "personLoadFailed")}</h1>
      {!missing && <button type="button" onClick={() => void personQuery.refetch()}>{t("usersRetry")}</button>}
      <Link to="/library">{t("personBackToLibrary")}</Link>
    </div></main>;
  }

  return <main className="personPage">
    <div className="personLayout">
      <aside className="personProfile" aria-busy={personQuery.isPending} aria-labelledby="person-name">
        {person ? <>
          <img className="personPortrait" src={person.image_url || DefaultProfile} alt={person.name}
            onError={(event) => { event.currentTarget.src = DefaultProfile; }} />
          <div className="personIdentity">
            <p className="personEyebrow">{t("contributorLabel")}</p>
            <h1 id="person-name">{person.name}</h1>
            <p className="personVideoCount">{total !== undefined ? t("appearsOnVideos", { count: total }) : "…"}</p>
          </div>
          {person.description && <div className="personAbout">
            <p ref={setDescription} className={`personDescription ${descOpen ? "isExpanded" : ""}`}>{formatDescription(person.description)}</p>
            {(overflow || descOpen) && <button type="button" className="personReadMore" aria-expanded={descOpen}
              onClick={() => setDescOpen((value) => !value)}>{t(descOpen ? "readLess" : "readMore")}</button>}
          </div>}
          <button className="personShare" type="button" onClick={() => void share()}>{ShareSVG}{t("share")}</button>
          {shareStatus && <p className="personShareStatus" role="status">{t(shareStatus)}</p>}
        </> : <div className="personProfileSkeleton" role="status">
          <div className="skeleton-thumbnail" /><div className="skeleton-title-large" /><div className="skeleton-text-small" /><div className="skeleton-description" />
        </div>}
      </aside>
      <section className="personVideos" aria-labelledby="person-videos-heading" aria-busy={personQuery.isPending || videoQuery.isFetching}>
        <div className="personVideosToolbar">
          <h2 id="person-videos-heading">{t("personVideosHeading")}{total !== undefined && <span>{total}</span>}</h2>
          <CustomSelect value={sort} options={[
            { value: "date", label: t("searchSortNewest") },
            { value: "views", label: t("searchSortViews") },
          ]} onChange={setSort} ariaLabel={t("searchSortBy")} rootClassName="personSortSelect" />
        </div>
        {videoQuery.isError && !videos.length ? <div className="personStatus" role="alert"><p>{t("personVideosFailed")}</p>
          <button type="button" onClick={() => void videoQuery.refetch()}>{t("usersRetry")}</button></div> :
          <div className="videoHolder personVideoGrid">
            {personQuery.isPending || videoQuery.isPending ? Array.from({ length: 6 }, (_, index) =>
              <div className="skeleton-item" key={index}><div className="skeleton-thumbnail" /><div className="skeleton-content"><div className="skeleton-title" /><div className="skeleton-text" /></div></div>) :
              videos.map((video) => <Item key={video.id} props={{ ...video, progress_seconds: Number(video.progress_seconds ?? 0), percentage_watched: Number(video.percentage_watched ?? 0) }} />)}
          </div>}
        {videoQuery.isSuccess && videos.length === 0 && <p className="personEmpty">{t("personNoVideos")}</p>}
        {videos.length > 0 && <InfiniteScroll key={sort}
          hasMore={videoQuery.hasNextPage} fetching={videoQuery.isFetching} error={videoQuery.isError}
          onLoadMore={loadMore} loadingLabel={t("searchLoadingResults")} />}
      </section>
    </div>
  </main>;
}

export default function PersonPage() {
  const { id } = useParams();
  return <PersonProfile key={id} id={id || ""} />;
}
