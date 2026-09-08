import { getVideoThumbnail } from "~/components/shared/videoMedia";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { AddSVG, CloseSVG, UploadSVG } from "~/constants";
import { fetchFn } from "~/API";
import { getToken } from "~/functions";
import type {
  FetchPlaylistT,
  PlaylistVideoT,
  PlaylistVideosT,
  SearchT,
} from "~/types";
import Sidebar from "../myVideosPage/sidebar/sidebar";
import PlaylistVideoList from "./playlistVideoList";
import styles from "./editPlaylistPage.module.css";
import statusStyles from "../uploadPage/uploadStatus.module.css";
import { useI18n } from "~/i18n";
import CustomSelect from "~/components/customSelect/customSelect";

function reorderPlaylistVideos(
  videos: PlaylistVideoT[],
  draggedId: string,
  targetId: string
) {
  const draggedIndex = videos.findIndex((video) => video.id === draggedId);
  const targetIndex = videos.findIndex((video) => video.id === targetId);

  if (
    draggedIndex === -1 ||
    targetIndex === -1 ||
    draggedIndex === targetIndex
  ) {
    return videos;
  }

  const nextVideos = [...videos];
  const [draggedVideo] = nextVideos.splice(draggedIndex, 1);
  nextVideos.splice(targetIndex, 0, draggedVideo);
  return nextVideos;
}

function EditPlaylistPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const playlistId = searchParams.get("playlist");
  const initialStatus = searchParams.get("status");

  const myHeaders = useRef(new Headers());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [token, setToken] = useState("");
  const [title, setTitle] = useState("");
  const [oldTitle, setOldTitle] = useState("");
  const [description, setDescription] = useState("");
  const [oldDescription, setOldDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [oldTags, setOldTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [status, setStatus] = useState<"public" | "private">(
    initialStatus === "public" ? "public" : "private"
  );
  const [oldStatus, setOldStatus] = useState<"public" | "private">(
    initialStatus === "public" ? "public" : "private"
  );
  const [featured, setFeatured] = useState(false);
  const [oldFeatured, setOldFeatured] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [pendingThumbnailFile, setPendingThumbnailFile] = useState<File | null>(
    null
  );
  const [pendingThumbnailUrl, setPendingThumbnailUrl] = useState<string | null>(
    null
  );
  const [thumbnailMarkedForRemoval, setThumbnailMarkedForRemoval] =
    useState(false);
  const [playlistVideos, setPlaylistVideos] = useState<PlaylistVideoT[]>([]);
  const [playlistVideoSearch, setPlaylistVideoSearch] = useState("");
  const [debouncedPlaylistVideoSearch, setDebouncedPlaylistVideoSearch] =
    useState("");
  const [isReorderingPlaylistVideos, setIsReorderingPlaylistVideos] =
    useState(false);
  const [isAddingVideoId, setIsAddingVideoId] = useState<string | null>(null);
  const [isDeletingVideoId, setIsDeletingVideoId] = useState<string | null>(
    null
  );
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false);
  const [isRemovingThumbnail, setIsRemovingThumbnail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoMutationRef = useRef(false);
  const videosBusy = isReorderingPlaylistVideos || !!isAddingVideoId || !!isDeletingVideoId;

  useLayoutEffect(() => {
    const userToken = getToken();
    if (!userToken) return;
    setToken(userToken);

    myHeaders.current = new Headers();
    myHeaders.current.append("Content-Type", "application/json");
    myHeaders.current.append("Authorization", `Bearer ${userToken}`);
  }, []);

  const {
    data: playlistData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [`playlist-edit-${playlistId}`],
    queryFn: () =>
      fetchFn<FetchPlaylistT>({
        route: `api/playlists/${playlistId}`,
        options: {
          method: "GET",
          headers: myHeaders.current,
        },
      }),
    enabled: !!token && !!playlistId,
    refetchOnWindowFocus: false,
  });

  const playlistDetails = playlistData?.playlist;

  const { data: playlistVideosData, isPending: videosLoading, isError: videosError, refetch: reloadVideos } = useQuery({
    queryKey: [`playlist-edit-videos-${playlistId}`],
    queryFn: async ({ signal }) => {
      const videos: PlaylistVideoT[] = [];
      let page = 1;
      while (true) {
        const result = await fetchFn<PlaylistVideosT>({ route: `api/playlists/${playlistId}/videos?limit=100&page=${page}`,
          options: { method: "GET", headers: myHeaders.current, signal } });
        videos.push(...result.videos);
        if (!result.pagination.hasNextPage || page >= result.pagination.totalPages) break;
        page++;
      }
      return { videos };
    },
    enabled: !!token && !!playlistId,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!playlistDetails) return;


    const nextStatus =
      playlistDetails.status ??
      (initialStatus === "public" ? "public" : "private");
    const nextFeatured = playlistDetails.featured === true;
    const nextTags = playlistDetails.tags ?? [];

    setTitle(playlistDetails.title || "");
    setOldTitle(playlistDetails.title || "");
    setDescription(playlistDetails.description || "");
    setOldDescription(playlistDetails.description || "");
    setTags(nextTags);
    setOldTags(nextTags);
    setStatus(nextStatus);
    setOldStatus(nextStatus);
    setFeatured(nextFeatured);
    setOldFeatured(nextFeatured);
    setThumbnailUrl(playlistDetails.thumbnail_url || null);
    setPendingThumbnailFile(null);
    setPendingThumbnailUrl(null);
    setThumbnailMarkedForRemoval(false);
  }, [playlistDetails, initialStatus]);

  useEffect(() => {
    if (!playlistVideosData) return;
    setPlaylistVideos(playlistVideosData.videos || []);
  }, [playlistVideosData]);

  useEffect(() => {
    return () => {
      if (pendingThumbnailUrl) {
        URL.revokeObjectURL(pendingThumbnailUrl);
      }
    };
  }, [pendingThumbnailUrl]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedPlaylistVideoSearch(playlistVideoSearch.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [playlistVideoSearch]);

  const detailsModified = useMemo(() => {
    return (
      title !== oldTitle ||
      description !== oldDescription ||
      JSON.stringify(tags) !== JSON.stringify(oldTags) ||
      status !== oldStatus ||
      featured !== oldFeatured
    );
  }, [
    title,
    oldTitle,
    description,
    oldDescription,
    tags,
    oldTags,
    status,
    oldStatus,
    featured,
    oldFeatured,
  ]);

  const displayedThumbnailUrl = thumbnailMarkedForRemoval
    ? null
    : pendingThumbnailUrl || thumbnailUrl;

  const thumbnailModified = thumbnailMarkedForRemoval || !!pendingThumbnailFile;

  const { data: playlistVideoSearchData, isFetching: isSearchingPlaylistVideos } =
    useQuery({
      queryKey: ["playlist-video-search", debouncedPlaylistVideoSearch],
      queryFn: () =>
        fetchFn<SearchT>({
          route: `api/videos/search?q=${encodeURIComponent(
            debouncedPlaylistVideoSearch
          )}`,
          options: {
            method: "GET",
            headers: myHeaders.current,
          },
        }),
      enabled: !!token && debouncedPlaylistVideoSearch.length > 0,
      refetchOnWindowFocus: false,
    });

  const filteredSearchVideos = useMemo(() => {
    const existingIds = new Set(playlistVideos.map((video) => video.id));
    return (playlistVideoSearchData?.videos || []).filter(
      (video) => !existingIds.has(video.id)
    );
  }, [playlistVideoSearchData?.videos, playlistVideos]);

  const addTag = () => {
    const normalized = tagInput.trim();
    if (!normalized) return;
    if (tags.includes(normalized)) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, normalized]);
    setTagInput("");
  };

  const removeTag = (tagToRemove: string) => {
    setTags((prev) => prev.filter((tag) => tag !== tagToRemove));
  };

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  };

  const handleSaveDetails = async () => {
    if (!playlistId) return;

    setIsSavingDetails(true);
    setError(null);

    try {
      const response = await fetchFn<{ success: boolean }>({
        route: `api/playlists-moderation/playlist-details/${playlistId}`,
        options: {
          method: "PATCH",
          headers: myHeaders.current,
          body: JSON.stringify({
            title,
            description,
            tags,
            status,
            featured,
          }),
        },
      });

      if (!response?.success) {
        setError(t("playlistSaveDetailsFailed"));
        return;
      }

      setOldTitle(title);
      setOldDescription(description);
      setOldTags([...tags]);
      setOldStatus(status);
      setOldFeatured(featured);
    } catch (err) {
      console.error("Error saving playlist details:", err);
      setError(t("playlistSaveDetailsFailed"));
    } finally {
      setIsSavingDetails(false);
    }
  };

  const uploadThumbnail = async (file: File) => {
    if (!playlistId) return;

    setIsUploadingThumbnail(true);
    setError(null);

    try {
      const headers = new Headers();
      headers.append("Authorization", `Bearer ${getToken()}`);

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetchFn<{
        success: boolean;
        playlist?: { thumbnail_url?: string | null };
      }>({
        route: `api/playlists-moderation/${playlistId}/thumbnail`,
        options: {
          method: "POST",
          headers,
          body: formData,
        },
      });

      if (!response?.success) {
        setError(t("playlistUploadThumbnailFailed"));
        return;
      }

      const nextThumbnailUrl = response.playlist?.thumbnail_url || null;
      setThumbnailUrl(nextThumbnailUrl);
      setPendingThumbnailFile(null);
      setPendingThumbnailUrl(null);
      setThumbnailMarkedForRemoval(false);
    } catch (err) {
      console.error("Error uploading playlist thumbnail:", err);
      setError(t("playlistUploadThumbnailFailed"));
    } finally {
      setIsUploadingThumbnail(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const resetThumbnailSelection = () => {
    setPendingThumbnailFile(null);
    setPendingThumbnailUrl(null);
    setThumbnailMarkedForRemoval(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPendingThumbnailFile(file);
    setPendingThumbnailUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      return URL.createObjectURL(file);
    });
    setThumbnailMarkedForRemoval(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSaveThumbnail = async () => {
    if (!playlistId) return;

    if (thumbnailMarkedForRemoval) {
      setIsRemovingThumbnail(true);
      setError(null);

      try {
        const headers = new Headers();
        headers.append("Authorization", `Bearer ${getToken()}`);
        headers.append("Content-Type", "application/json");

        const response = await fetchFn<{ success: boolean }>({
          route: `api/playlists-moderation/${playlistId}/thumbnail`,
          options: {
            method: "POST",
            headers,
            body: JSON.stringify({
              file: null,
            }),
          },
        });

        if (!response?.success) {
          setError(t("playlistRemoveThumbnailFailed"));
          return;
        }

        setThumbnailUrl(null);
        resetThumbnailSelection();
      } catch (err) {
        console.error("Error removing playlist thumbnail:", err);
        setError(t("playlistRemoveThumbnailFailed"));
      } finally {
        setIsRemovingThumbnail(false);
      }

      return;
    }

    if (!pendingThumbnailFile) return;

    await uploadThumbnail(pendingThumbnailFile);
  };

  const handleRemoveThumbnail = () => {
    if (!thumbnailUrl && !pendingThumbnailFile) return;

    if (pendingThumbnailFile) {
      resetThumbnailSelection();
      return;
    }

    setPendingThumbnailFile(null);
    setPendingThumbnailUrl(null);
    setThumbnailMarkedForRemoval(true);
  };

  const handlePlaylistVideoMove = async (videoId: string, targetId: string) => {
    if (!playlistId || videoMutationRef.current) return;
    const previousVideos = playlistVideos;
    const nextVideos = reorderPlaylistVideos(previousVideos, videoId, targetId);
    if (nextVideos === previousVideos) return;
    videoMutationRef.current = true;
    setPlaylistVideos(nextVideos);
    setIsReorderingPlaylistVideos(true);
    setError(null);
    try {
      const result = await fetchFn<{ success: boolean }>({
        route: `api/playlists-moderation/${playlistId}/items/move`,
        options: { method: "PATCH", headers: myHeaders.current,
          body: JSON.stringify({ video_id: videoId, to_position: nextVideos.findIndex(video => video.id === videoId) + 1 }) },
      });
      if (!result.success) throw new Error("Playlist reorder failed");
    } catch {
      setPlaylistVideos(previousVideos);
      setError(t("playlistReorderVideosFailed"));
    } finally { videoMutationRef.current = false; setIsReorderingPlaylistVideos(false); }
  };

  const handleAddPlaylistVideo = async (video: PlaylistVideoT) => {
    if (!playlistId || videoMutationRef.current) return;
    videoMutationRef.current = true;

    setIsAddingVideoId(video.id);
    setError(null);

    try {
      const response = await fetchFn<{ success: boolean }>({
        route: `api/playlists-moderation/${playlistId}/items`,
        options: {
          method: "POST",
          headers: myHeaders.current,
          body: JSON.stringify({
            video_id: video.id,
          }),
        },
      });

      if (!response?.success) {
        setError(t("playlistAddVideoFailed"));
        return;
      }

      setPlaylistVideos((currentVideos) => [...currentVideos, video]);
      setPlaylistVideoSearch("");
      setDebouncedPlaylistVideoSearch("");
    } catch (err) {
      console.error("Error adding video to playlist:", err);
      setError(t("playlistAddVideoFailed"));
    } finally {
      videoMutationRef.current = false;
      setIsAddingVideoId(null);
    }
  };

  const handleDeletePlaylistVideo = async (videoId: string) => {
    if (!playlistId || videoMutationRef.current) return;
    videoMutationRef.current = true;

    const previousVideos = playlistVideos;
    setIsDeletingVideoId(videoId);
    setError(null);
    setPlaylistVideos((currentVideos) =>
      currentVideos.filter((video) => video.id !== videoId)
    );

    try {
      const response = await fetchFn<{ success: boolean }>({
        route: `api/playlists-moderation/${playlistId}/items/${videoId}`,
        options: {
          method: "DELETE",
          headers: myHeaders.current,
        },
      });

      if (!response?.success) {
        setPlaylistVideos(previousVideos);
        setError(t("playlistDeleteVideoFailed"));
      }
    } catch (err) {
      console.error("Error deleting video from playlist:", err);
      setPlaylistVideos(previousVideos);
      setError(t("playlistDeleteVideoFailed"));
    } finally {
      videoMutationRef.current = false;
      setIsDeletingVideoId(null);
    }
  };

  if (!playlistId) {
    return (
      <main className={`uploadMain ${statusStyles.page} ${styles.page}`}>
        <Sidebar />
        <div className="uploadSide max-w-full! w-full">
          <h1>{t("playlistEditTitle")}</h1>
          <p className="mt-1 mb-3 links">{t("playlistMissingId")}</p>
          <button
            type="button"
            className="cancelBtn mt-4"
            onClick={() => navigate("/my-playlists")}
          >
            {t("navMyPlaylists")}
          </button>
        </div>
      </main>
    );
  }

  if (isError) {
    return (
      <main className={`uploadMain ${statusStyles.page} ${styles.page}`}>
        <Sidebar />
        <div className="uploadSide max-w-full! w-full">
          <h1>{t("playlistEditTitle")}</h1>
          <p className="mt-1 mb-3 links">{t("playlistLoadFailed")}</p>
          <button
            type="button"
            className="cancelBtn mt-4"
            onClick={() => navigate("/my-playlists")}
          >
            {t("navMyPlaylists")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={`uploadMain ${statusStyles.page} ${styles.page}`}>
      <Sidebar />
      <div className="uploadSide max-w-full! w-full">
        <h1>{t("playlistEditTitle")}</h1>
        <p className="mt-1 mb-3 links">
          {t("playlistEditHelp")}
        </p>

        {error && (
          <div className="errorBanner" role="alert">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="dismissErrorBtn" aria-label={t("close")}
            >
              {CloseSVG}
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="loadingContainer">
            <div className="uploadSpinner" />
            <p>{t("playlistLoading")}</p>
          </div>
        ) : (
          <div className={styles.layout}>
            <div className="videoDetailsForm">
                <section className="editSection">
                  <h2 className="editSectionTitle">{t("playlistThumbnail")}</h2>

                  <input type="file" ref={fileInputRef} accept="image/*" onChange={handleFileSelect} hidden />
                  <div className="thumbnailSettingsPreview">
                    {displayedThumbnailUrl ? <img src={displayedThumbnailUrl} alt={t("playlistThumbnail")} className="thumbnailPickerImage" />
                      : <div className="thumbnailSettingsEmpty">{UploadSVG}<span>{t("selectThumbnailImage")}</span></div>}
                  </div>
                  <div className="thumbnailSourceActions">
                    <button type="button" className="saveCaptionsBtn thumbnailSourceButton" onClick={() => fileInputRef.current?.click()} disabled={isUploadingThumbnail || isRemovingThumbnail}>
                      {UploadSVG}{t("uploadSelectFile")}
                    </button>
                  </div>
                  <p className="formHint">{pendingThumbnailFile?.name || t("imageFormatsHint")}</p>

                  <div className="captionsActions">
                    <div className="captionsButtonGroup">
                      <button
                        type="button"
                        onClick={handleSaveThumbnail}
                        disabled={
                          !thumbnailModified ||
                          isUploadingThumbnail ||
                          isRemovingThumbnail
                        }
                        className="saveCaptionsBtn"
                      >
                        {isUploadingThumbnail || isRemovingThumbnail ? (
                          <>
                            <div className="uploadSpinner tiny" />
                            {t("saving")}
                          </>
                        ) : (
                          t("saveThumbnail")
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleRemoveThumbnail}
                        disabled={
                          (!thumbnailUrl && !pendingThumbnailFile) ||
                          isUploadingThumbnail ||
                          isRemovingThumbnail
                        }
                        className="deleteCaptionsBtn"
                      >
                        {pendingThumbnailFile ? t("clearSelection") : t("removeThumbnail")}
                      </button>
                      {thumbnailModified && (
                        <button
                          type="button"
                          onClick={resetThumbnailSelection}
                          className="cancelBtn thumbnailCancelBtn"
                          disabled={isUploadingThumbnail || isRemovingThumbnail}
                        >
                          {t("cancel")}
                        </button>
                      )}
                    </div>
                    <p className="formHint thumbnailHint">
                      {thumbnailModified ? (
                        <span className="unsavedIndicator">
                          • {t("editorUnsavedChanges")}
                        </span>
                      ) : (
                        t("selectNewImageHint")
                      )}
                    </p>
                  </div>
                </section>
                <section className="editSection">
                  <h2 className="editSectionTitle">{t("playlistDetails")}</h2>

                  <div className="formGroup">
                    <label htmlFor="playlistTitle">{t("title")}</label>
                    <input
                      id="playlistTitle"
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={t("enterPlaylistTitle")}
                      maxLength={100}
                    />
                    <span className="charCount">{title.length}/100</span>
                  </div>

                  <div className="formGroup">
                    <label htmlFor="playlistDescription">{t("description")}</label>
                    <textarea
                      id="playlistDescription"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t("enterPlaylistDescription")}
                      rows={5}
                      maxLength={5000}
                    />
                    <span className="charCount">{description.length}/5000</span>
                  </div>

                  <div className="formGroup">
                    <label htmlFor="playlistTags">{t("tags")}</label>
                    <div className="tagsContainer">
                      {tags.map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                          <button
                            type="button"
                            className="removeTagBtn" aria-label={`${t("adminDelete")}: ${tag}`}
                            onClick={() => removeTag(tag)}
                          >
                            {CloseSVG}
                          </button>
                        </span>
                      ))}
                      <input
                        id="playlistTags"
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={handleTagKeyDown}
                        onBlur={addTag}
                        placeholder={
                          tags.length === 0 ? t("pressEnterToAddTags") : ""
                        }
                      />
                    </div>
                  </div>

                  <div className="formGroup mt-7.5 mb-5">
                    <label htmlFor="playlistStatus">{t("visibility")}</label>
                    <p className="formHint">
                      {status === "public"
                        ? t("publicVisibilityHelp")
                        : t("privateVisibilityHelp")}
                    </p>
                    <CustomSelect
                      id="playlistStatus"
                      value={status}
                      onChange={(value) => setStatus(value as "public" | "private")}
                      options={[
                        { value: "public", label: t("adminPublic") },
                        { value: "private", label: t("adminPrivate") },
                      ]}
                      ariaLabel={t("visibility")}
                      rootClassName={statusStyles.compactSelect}
                      triggerClassName="visibilitySelect"
                    />
                  </div>

                  <div className="formGroup mt-7.5 mb-5">
                    <label htmlFor="playlistFeatured">{t("featured")}</label>
                    <p className="formHint">
                      {t("playlistFeaturedHelp")}
                    </p>
                    <CustomSelect
                      id="playlistFeatured"
                      value={featured ? "true" : "false"}
                      onChange={(value) => setFeatured(value === "true")}
                      options={[
                        { value: "false", label: t("adminNo") },
                        { value: "true", label: t("adminYes") },
                      ]}
                      ariaLabel={t("featured")}
                      rootClassName={statusStyles.compactSelect}
                      triggerClassName="visibilitySelect"
                    />
                  </div>

                  <div className="captionsActions">
                    <p className="formHint">
                      {detailsModified && (
                        <span className="unsavedIndicator">
                          • {t("editorUnsavedChanges")}
                        </span>
                      )}
                    </p>
                    <div className="captionsButtonGroup">
                      <button
                        type="button"
                        onClick={handleSaveDetails}
                        disabled={!detailsModified || isSavingDetails || !title.trim()}
                        className="saveCaptionsBtn"
                      >
                        {isSavingDetails ? (
                          <>
                            <div className="uploadSpinner tiny" />
                            {t("saving")}
                          </>
                        ) : (
                          t("saveChanges")
                        )}
                      </button>
                    </div>
                  </div>
                </section>
            </div>
            <aside className={`videoDetailsForm ${styles.videosColumn}`}>
                <section className="editSection">
                  <h2 className="editSectionTitle">{t("playlistVideos")}</h2>

                  <div className="formGroup">
                    <label htmlFor="playlistVideoSearch">{t("addVideo")}</label>
                    <input
                      id="playlistVideoSearch"
                      type="text"
                      className="playlistVideoSearchInput"
                      value={playlistVideoSearch}
                      onChange={(e) => setPlaylistVideoSearch(e.target.value)}
                      placeholder={t("searchVideosAddPlaylist")}
                    />

                    <div className="playlistVideoSearchBlock">
                      {debouncedPlaylistVideoSearch && (
                        <div className="playlistVideoSearchResults">
                          {isSearchingPlaylistVideos ? (
                            <p className="formHint">{t("searchingVideos")}</p>
                          ) : filteredSearchVideos.length ? (
                            filteredSearchVideos.map((video) => (
                              <div
                                key={video.id}
                                className="playlistVideoSearchRow"
                              >
                                <div className="playlistVideoSearchInfo">
                                  <img
                                    src={getVideoThumbnail(video)}
                                    alt={video.title}
                                    className="playlistVideoSearchThumb"
                                  />
                                  <span className="flex flex-col gap-1 min-w-0">
                                    <strong className="line-clamp-2">
                                      {video.title}
                                    </strong>
                                    <span className="text-sm opacity-80">
                                      {video.uploader_name}
                                    </span>
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  className="saveCaptionsBtn playlistVideoAddBtn"
                                  onClick={() => handleAddPlaylistVideo(video)}
                                  disabled={videosBusy || videosLoading || videosError}
                                >
                                  {isAddingVideoId === video.id ? (
                                    <>
                                      <div className="uploadSpinner tiny" />
                                      {t("saving")}
                                    </>
                                  ) : (
                                    <>
                                      {AddSVG}
                                      {t("addVideo")}
                                    </>
                                  )}
                                </button>
                              </div>
                            ))
                          ) : (
                            <p className="formHint">
                              {t("playlistSearchEmpty")}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="playlistVideoSearchDivider" />
                    </div>
                  </div>

                  <div className="formGroup">
                    {videosLoading ? <p className="formHint" role="status">{t("playlistLoading")}</p> : videosError ? <div role="alert"><p>{t("playlistLoadFailed")}</p><button type="button" className="saveCaptionsBtn" onClick={() => void reloadVideos()}>{t("usersRetry")}</button></div> : playlistVideos.length ? (
                      <>
                        <PlaylistVideoList videos={playlistVideos} disabled={videosBusy} onMove={handlePlaylistVideoMove} onDelete={handleDeletePlaylistVideo} />

                        <div className="captionsActions">
                          <p className="formHint">
                            {isReorderingPlaylistVideos ? (
                              <span className="unsavedIndicator">
                                {"\u2022"} {t("saving")}
                              </span>
                            ) : (
                              t("playlistReorderHelp")
                            )}
                          </p>
                        </div>
                      </>
                    ) : (
                      <p className="formHint">{t("playlistNoVideos")}</p>
                    )}
                  </div>
                </section>
            </aside>
          </div>
        )}

        <section className="bottomBtns">
          <button
            type="button"
            className="cancelBtn"
            onClick={() => navigate("/my-playlists")}
          >
            {t("navMyPlaylists")}
          </button>
          <Link to={`/playlist/${playlistId}`} className="uploadBtn">
            {t("adminOpenPlaylist")}
          </Link>
        </section>
      </div>
    </main>
  );
}

export default EditPlaylistPage;
