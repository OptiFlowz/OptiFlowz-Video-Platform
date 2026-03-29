import { useParams, useSearchParams, Link } from "react-router";
import VerticalSlider from "./verticalSlider/verticalSlider";
import { useState, useRef, useLayoutEffect, useMemo, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import type { SearchT, PlaylistSearchRes, PeopleSearchRes } from "~/types";
import { LibrarySVG, NoResultsSVG } from "~/constants";
import { formatDate, formatDescription, formatViews, getToken } from "~/functions";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import { useI18n } from "~/i18n";

const SkeletonSearchItem = () => (
  <div className="skeleton-search-item">
    <div className="skeleton-search-thumbnail"></div>
    <div className="skeleton-search-content">
      <div className="skeleton-search-title"></div>
      <div className="skeleton-search-text"></div>
      <div className="skeleton-search-text short"></div>
    </div>
  </div>
);

const SkeletonPlaylistItem = () => (
  <div className="item flex gap-4 items-start">
    <div className="thumbnail relative">
      <div className="skeleton-playlist-thumbnail"></div>
    </div>
    <div className="w-full flex flex-col mt-1 gap-2">
      <div className="skeleton-playlist-title"></div>
      <div className="skeleton-playlist-desc"></div>
      <div className="skeleton-playlist-desc short"></div>
      <div className="skeleton-playlist-meta"></div>
    </div>
  </div>
);

const SkeletonPersonItem = () => (
  <div className="item personItem flex gap-4 items-center rounded-[20px]">
    <div className="thumbnail">
      <div className="skeleton-person-image"></div>
    </div>
    <div className="flex flex-col gap-2 flex-1">
      <div className="skeleton-person-name"></div>
      <div className="skeleton-person-bio"></div>
      <div className="skeleton-person-bio short"></div>
      <div className="skeleton-person-badge"></div>
    </div>
  </div>
);

function SearchPage() {
  const { t } = useI18n();
  const { searchValue } = useParams();
  const [searchParams] = useSearchParams();

  const categoryId = searchParams.get("category");
  const tagId = searchParams.get("tag");
  const personId = searchParams.get("person");
  const categoryTitle = searchParams.get("title");
  const personName = searchParams.get("name");

  const [selected, setSelected] = useState(0);

  const myHeaders = useRef(new Headers());
  const [token, setToken] = useState<string | undefined>(undefined);

  useLayoutEffect(() => {
    const userToken = getToken();
    if(!userToken) return;
    setToken(userToken);
    myHeaders.current.set("Authorization", `Bearer ${userToken}`);
  }, []);

  const videoRoute = categoryId
    ? `api/videos/search?category=${categoryId}`
    : tagId
    ? `api/videos/search?tags=${tagId}`
    : personId
    ? `api/videos/search?person=${personId}`
    : `api/videos/search?q=${encodeURIComponent(searchValue || "")}`;

  const q = useMemo(() => {
    const fallback = searchValue || categoryTitle || tagId || personName || "";
    return decodeURIComponent(fallback);
  }, [searchValue, categoryTitle, tagId, personName]);

  const videosEnabled = !!token && (!!searchValue || !!categoryId || !!tagId || !!personId);
  const othersEnabled = !!token && q.trim().length > 0;

  const [videoQ, playlistQ, peopleQ] = useQueries({
    queries: [
      {
        queryKey: ["search-videos", videoRoute],
        queryFn: () =>
          fetchFn({
            route: videoRoute,
            options: { method: "GET", headers: myHeaders.current },
          }),
        enabled: videosEnabled,
      },
      {
        queryKey: ["search-playlists", q],
        queryFn: () =>
          fetchFn({
            route: `api/playlists/search?q=${encodeURIComponent(q)}`,
            options: { method: "GET", headers: myHeaders.current },
          }),
        enabled: othersEnabled,
      },
      {
        queryKey: ["search-people", q],
        queryFn: () =>
          fetchFn({
            route: `api/people/search?q=${encodeURIComponent(q)}`,
            options: { method: "GET", headers: myHeaders.current },
          }),
        enabled: othersEnabled,
      },
    ],
  });

  const showLoader =
    videoQ.isLoading ||
    playlistQ.isLoading ||
    peopleQ.isLoading ||
    videoQ.isFetching ||
    playlistQ.isFetching ||
    peopleQ.isFetching;

  // brojevi za dugmiće (prefer: pagination.total, fallback: length)
  const videosCount =
    (videoQ.data as any)?.pagination?.total ?? ((videoQ.data as SearchT)?.videos?.length ?? 0);

  const playlistsCount =
    (playlistQ.data as PlaylistSearchRes | undefined)?.pagination?.total ??
    ((playlistQ.data as PlaylistSearchRes | undefined)?.playlists?.length ?? 0);

  const peopleCount =
    (peopleQ.data as PeopleSearchRes | undefined)?.pagination?.total ??
    ((peopleQ.data as PeopleSearchRes | undefined)?.people?.length ?? 0);

  // NEW: da li uopšte ima bilo kakvih rezultata
  const hasAnyResults = videosCount > 0 || playlistsCount > 0 || peopleCount > 0;

  // NEW: da li je trenutno selektovan tab prazan
  const isSelectedEmpty =
    (selected === 0 && videosCount === 0) ||
    (selected === 1 && playlistsCount === 0) ||
    (selected === 2 && peopleCount === 0);

  // NEW: auto-switch na prvi tab koji ima rezultate (posle učitavanja)
  useEffect(() => {
    if (showLoader) return;
    if (!hasAnyResults) return;

    if (isSelectedEmpty) {
      if (videosCount > 0) setSelected(0);
      else if (playlistsCount > 0) setSelected(1);
      else if (peopleCount > 0) setSelected(2);
    }
  }, [
    showLoader,
    hasAnyResults,
    isSelectedEmpty,
    videosCount,
    playlistsCount,
    peopleCount,
    selected,
  ]);

  // NEW: "No results" samo ako nigde nema rezultata
  const noResults = useMemo(() => {
    if (showLoader) return false;
    return !hasAnyResults;
  }, [showLoader, hasAnyResults]);

  const skeletonVideos = Array.from({ length: 8 }).map((_, i) => (
    <SkeletonSearchItem key={`skeleton-video-${i}`} />
  ));

  const skeletonPlaylists = Array.from({ length: 6 }).map((_, i) => (
    <SkeletonPlaylistItem key={`skeleton-playlist-${i}`} />
  ));

  const skeletonPeople = Array.from({ length: 6 }).map((_, i) => (
    <SkeletonPersonItem key={`skeleton-person-${i}`} />
  ));

  return (
    <main className="search">
      <div className="heading hero">
        {searchValue && !categoryId && (
          <h2 className="font-light text-3xl">
            {t("searchResultsFor", { value: searchValue || "" })}
          </h2>
        )}

        {categoryId && categoryTitle && (
          <h2 className="font-light text-3xl">
            {t("categoryResultsFor", { value: decodeURIComponent(categoryTitle) })}
          </h2>
        )}

        {tagId && !categoryTitle && (
          <h2 className="font-light text-3xl">
            {t("tagResultsFor", { value: tagId || "" })}
          </h2>
        )}

        {personName && (
          <h2 className="font-light text-3xl">
            {t("personResultsFor", { value: decodeURIComponent(personName) })}
          </h2>
        )}

        <span className="buttons">
          {showLoader ? (
            <>
              <div className="skeleton-button-tab"></div>
              <div className="skeleton-button-tab"></div>
              <div className="skeleton-button-tab"></div>
            </>
          ) : (
            <>
              {videosCount > 0 ? (
                <button
                  className={`button ${selected === 0 ? "selected" : ""}`}
                  onClick={() => setSelected(0)}
                >
                  {t("videosTab")} {videosCount > 0 ? <span className="count">{videosCount}</span> : ""}
                </button>
              ) : (
                ""
              )}

              {playlistsCount > 0 ? (
                <button
                  className={`button ${selected === 1 ? "selected" : ""}`}
                  onClick={() => setSelected(1)}
                >
                  {t("playlistsTab")}{" "}
                  {playlistsCount > 0 ? <span className="count">{playlistsCount}</span> : ""}
                </button>
              ) : (
                ""
              )}

              {peopleCount > 0 ? (
                <button
                  className={`button ${selected === 2 ? "selected" : ""}`}
                  onClick={() => setSelected(2)}
                >
                  {t("contributorsTab")}{" "}
                  {peopleCount > 0 ? <span className="count">{peopleCount}</span> : ""}
                </button>
              ) : (
                ""
              )}
            </>
          )}
        </span>
      </div>

      {showLoader ? (
        <div className={`resultHolder ${personId ? "large" : ""}`}>
          <div className="verticalSlider grid gap-4">
            {selected === 0 && skeletonVideos}
            {selected === 1 && skeletonPlaylists}
            {selected === 2 && skeletonPeople}
          </div>
        </div>
      ) : noResults ? (
        <div className="resultHolder">
          <div className="flex flex-col py-10 px-10 max-sm:px-7 max-sm:py-7">
            <div className="mb-6">{NoResultsSVG}</div>
            <h3 className="text-2xl font-semibold">{t("noResultsTitle")}</h3>
            <p className="text-md mt-4">{t("noResultsText")}</p>
          </div>
        </div>
      ) : (
        <div className={`resultHolder ${personId ? "large" : ""}`}>
          {selected === 0 && <VerticalSlider props={videoQ.data as SearchT} />}

          {selected === 1 && (
            <div className="verticalSlider grid gap-4">
              {(playlistQ.data as PlaylistSearchRes).playlists.map((p) => (
                <Link key={p.id} to={`/playlist/${p.id}`} className="item flex gap-4 items-start">
                  <div className="thumbnail">
                    <img
                      src={p.thumbnail_url}
                      alt={p.title}
                      className="object-cover rounded"
                      loading="lazy"
                    />
                    <span className="pins absolute bottom-2.25 right-2.25 flex items-center gap-2">
                      <p className="flex items-center">{LibrarySVG}&nbsp;{t("playlistLabel")}</p>
                      <p>{t("videosLabel", { count: p.video_count })}</p>
                    </span>
                  </div>
                  <div className="w-full flex flex-col mt-1">
                    <h3 className="text-2xl font-semibold">{p.title}</h3>
                    <p className="text-ellipsis line-clamp-3 text-md opacity-70 pr-2">
                      {formatDescription(p.description)}
                    </p>
                    <p className="text-md font-normal">
                      <strong className="font-medium">{formatViews(p.view_count)}</strong> �{" "}
                      {formatDate(p.created_at)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {selected === 2 && (
            <div className="verticalSlider grid gap-4">
              {(peopleQ.data as PeopleSearchRes).people.map((person) => (
                <Link
                  key={person.id}
                  to={`/search?person=${person.id}&name=${encodeURIComponent(person.name)}`}
                  className="item personItem flex gap-4 items-start rounded-[20px]"
                  onClick={() => setSelected(0)}
                >
                  <div className="thumbnail">
                    <img
                      src={person.image_url || DefaultProfile}
                      alt={person.name}
                      className="object-cover rounded-xl! aspect-square! max-w-40"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-2xl font-semibold">{person.name}</h3>
                    <p className="text-md opacity-70 pr-2">
                      {person.description || t("noBiography")}
                    </p>
                    <p className="mt-1 text-md text-white font-medium bg-(--accentOrange) w-fit py-1.5 px-5 rounded-full">
                      {t("videosLabel", { count: person.total_video_count })}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

export default SearchPage;

