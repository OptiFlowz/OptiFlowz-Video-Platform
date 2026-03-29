import { Link, useNavigate, useSearchParams } from "react-router";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { AddSVG, CloseSVG, DeleteSVG, UploadSVG } from "~/constants";
import { fetchFn } from "~/API";
import { formatDescription, getToken } from "~/functions";
import type { PlaylistT, SearchT } from "~/types";
import Sidebar from "../myVideosPage/sidebar/sidebar";
import DefaultThumbnail from "../../../assets/DefaultThumbnail.webp";
import { useConstrainedSticky } from "~/components/shared/useConstrainedSticky";

function reorderPlaylistVideos(
  videos: PlaylistT["videos"],
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

function PlaylistVideoRowContent({
  video,
  index,
}: {
  video: PlaylistT["videos"][number];
  index: number;
}) {
  return (
    <>
      <img
        src={video.thumbnail_url}
        alt={video.title}
        className="h-14 w-24 rounded-lg object-cover"
      />
      <span className="flex flex-col gap-1 min-w-0">
        <strong className="playlistVideoTitleClamp">
          {index + 1}. {video.title}
        </strong>
        <span className="text-sm opacity-80">{video.uploader_name}</span>
      </span>
    </>
  );
}

function EditPlaylistPage() {
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
  const [playlistVideos, setPlaylistVideos] = useState<PlaylistT["videos"]>([]);
  const [draggedVideoId, setDraggedVideoId] = useState<string | null>(null);
  const [dragOverVideoId, setDragOverVideoId] = useState<string | null>(null);
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
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const dragStartVideosRef = useRef<PlaylistT["videos"]>([]);
  const previewAsideRef = useRef<HTMLElement | null>(null);
  const previewStickyRef = useRef<HTMLDivElement | null>(null);
  const previewBoundaryRef = useRef<HTMLElement | null>(null);
  const previewStickyStyle = useConstrainedSticky({
    containerRef: previewAsideRef,
    stickyRef: previewStickyRef,
    boundaryRef: previewBoundaryRef,
    disabledBelow: 1420,
    topOffset: 89,
    bottomGap: 24,
  });

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
      fetchFn<PlaylistT>({
        route: `api/playlists/${playlistId}`,
        options: {
          method: "GET",
          headers: myHeaders.current,
        },
      }),
    enabled: !!token && !!playlistId,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!playlistData) return;

    console.log("Loaded playlist data for editing:", playlistData);

    const nextStatus =
      playlistData.status ??
      (initialStatus === "public" ? "public" : "private");
    const nextFeatured = playlistData.featured === true;
    const nextTags = playlistData.tags ?? [];

    setTitle(playlistData.title || "");
    setOldTitle(playlistData.title || "");
    setDescription(playlistData.description || "");
    setOldDescription(playlistData.description || "");
    setTags(nextTags);
    setOldTags(nextTags);
    setStatus(nextStatus);
    setOldStatus(nextStatus);
    setFeatured(nextFeatured);
    setOldFeatured(nextFeatured);
    setThumbnailUrl(playlistData.thumbnail_url || null);
    setPendingThumbnailFile(null);
    setPendingThumbnailUrl(null);
    setThumbnailMarkedForRemoval(false);
    setPlaylistVideos(playlistData.videos || []);
  }, [playlistData, initialStatus]);

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
        setError("Failed to save playlist details.");
        return;
      }

      setOldTitle(title);
      setOldDescription(description);
      setOldTags([...tags]);
      setOldStatus(status);
      setOldFeatured(featured);
    } catch (err) {
      console.error("Error saving playlist details:", err);
      setError("Failed to save playlist details.");
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
        setError("Failed to upload playlist thumbnail.");
        return;
      }

      const nextThumbnailUrl = response.playlist?.thumbnail_url || null;
      setThumbnailUrl(nextThumbnailUrl);
      setPendingThumbnailFile(null);
      setPendingThumbnailUrl(null);
      setThumbnailMarkedForRemoval(false);
    } catch (err) {
      console.error("Error uploading playlist thumbnail:", err);
      setError("Failed to upload playlist thumbnail.");
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
          setError("Failed to remove playlist thumbnail.");
          return;
        }

        setThumbnailUrl(null);
        resetThumbnailSelection();
      } catch (err) {
        console.error("Error removing playlist thumbnail:", err);
        setError("Failed to remove playlist thumbnail.");
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

  const handlePlaylistVideoDragStart = (
    e: DragEvent<HTMLButtonElement>,
    videoId: string
  ) => {
    dragStartVideosRef.current = playlistVideos;
    setDraggedVideoId(videoId);
    setDragOverVideoId(videoId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", videoId);

    const row = e.currentTarget.closest(
      ".playlistVideoEditorRow"
    ) as HTMLDivElement | null;
    if (row) {
      const preview = row.cloneNode(true) as HTMLDivElement;
      preview.style.position = "fixed";
      preview.style.top = "-9999px";
      preview.style.left = "-9999px";
      preview.style.width = `${row.offsetWidth}px`;
      preview.style.pointerEvents = "none";
      preview.style.opacity = "0.98";
      preview.style.transform = "rotate(1deg)";
      preview.style.boxShadow = "0 18px 40px rgba(9, 28, 66, 0.18)";
      preview.style.background = "white";
      preview.style.zIndex = "9999";
      document.body.appendChild(preview);
      dragPreviewRef.current = preview;
      e.dataTransfer.setDragImage(preview, 24, 24);
    }
  };

  const handlePlaylistVideoDragOver = (
    e: DragEvent<HTMLDivElement>,
    videoId: string
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!draggedVideoId || draggedVideoId === videoId) return;
    setDragOverVideoId(videoId);
  };

  const handlePlaylistVideoDragEnter = (videoId: string) => {
    if (!draggedVideoId || draggedVideoId === videoId) return;

    setDragOverVideoId(videoId);
    setPlaylistVideos((currentVideos) =>
      reorderPlaylistVideos(currentVideos, draggedVideoId, videoId)
    );
  };

  const handlePlaylistVideoDrop = (
    e: DragEvent<HTMLDivElement>,
    targetVideoId: string
  ) => {
    e.preventDefault();
    const droppedVideoId =
      draggedVideoId || e.dataTransfer.getData("text/plain");
    if (!droppedVideoId) return;

    const previousVideos = dragStartVideosRef.current.length
      ? dragStartVideosRef.current
      : playlistVideos;
    const nextVideos = reorderPlaylistVideos(
      playlistVideos,
      droppedVideoId,
      targetVideoId
    );

    setPlaylistVideos(nextVideos);
    setDraggedVideoId(null);
    setDragOverVideoId(null);
    dragStartVideosRef.current = [];

    const previousIndex = previousVideos.findIndex(
      (video) => video.id === droppedVideoId
    );
    const nextIndex = nextVideos.findIndex((video) => video.id === droppedVideoId);

    if (
      previousIndex === -1 ||
      nextIndex === -1 ||
      previousIndex === nextIndex ||
      !playlistId
    ) {
      return;
    }

    setIsReorderingPlaylistVideos(true);
    setError(null);

    fetchFn<{ success: boolean }>({
      route: `api/playlists-moderation/${playlistId}/items/move`,
      options: {
        method: "PATCH",
        headers: myHeaders.current,
        body: JSON.stringify({
          video_id: droppedVideoId,
          to_position: nextIndex + 1,
        }),
      },
    }).catch((err) => {
      console.error("Error reordering playlist videos:", err);
      setPlaylistVideos(previousVideos);
      setError("Failed to reorder playlist videos.");
    }).finally(() => {
      setIsReorderingPlaylistVideos(false);
    });
  };

  const handlePlaylistVideoDragEnd = () => {
    setDraggedVideoId(null);
    setDragOverVideoId(null);
    dragStartVideosRef.current = [];
    if (dragPreviewRef.current) {
      dragPreviewRef.current.remove();
      dragPreviewRef.current = null;
    }
  };

  const handleAddPlaylistVideo = async (video: PlaylistT["videos"][number]) => {
    if (!playlistId || isAddingVideoId || isDeletingVideoId) return;

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
        setError("Failed to add video to playlist.");
        return;
      }

      setPlaylistVideos((currentVideos) => [...currentVideos, video]);
      setPlaylistVideoSearch("");
      setDebouncedPlaylistVideoSearch("");
    } catch (err) {
      console.error("Error adding video to playlist:", err);
      setError("Failed to add video to playlist.");
    } finally {
      setIsAddingVideoId(null);
    }
  };

  const handleDeletePlaylistVideo = async (videoId: string) => {
    if (!playlistId || isDeletingVideoId || isAddingVideoId) return;

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
        setError("Failed to delete video from playlist.");
      }
    } catch (err) {
      console.error("Error deleting video from playlist:", err);
      setPlaylistVideos(previousVideos);
      setError("Failed to delete video from playlist.");
    } finally {
      setIsDeletingVideoId(null);
    }
  };

  if (!playlistId) {
    return (
      <main className="uploadMain">
        <Sidebar />
        <div className="uploadSide max-w-full! w-full">
          <h1>Edit Playlist</h1>
          <p className="mt-3 links">Playlist id is missing.</p>
          <button
            type="button"
            className="cancelBtn mt-4"
            onClick={() => navigate("/my-playlists")}
          >
            Back to My Playlists
          </button>
        </div>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="uploadMain">
        <Sidebar />
        <div className="uploadSide max-w-full! w-full">
          <h1>Edit Playlist</h1>
          <p className="mt-3 links">Failed to load playlist data.</p>
          <button
            type="button"
            className="cancelBtn mt-4"
            onClick={() => navigate("/my-playlists")}
          >
            Back to My Playlists
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="uploadMain">
      <Sidebar />
      <div className="uploadSide max-w-full! w-full">
        <h1>Edit Playlist</h1>
        <p className="mt-3 links">
          Make changes to your playlist details and thumbnail.
        </p>

        {error && (
          <div className="errorBanner">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="dismissErrorBtn"
            >
              Ã—
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="loadingContainer">
            <div className="uploadSpinner" />
            <p>Loading playlist data...</p>
          </div>
        ) : (
          <div className="stepContentWithPreview">
            <aside ref={previewAsideRef} className="stepContentSidebar">
              <div
                ref={previewStickyRef}
                className="videoPreviewContainer"
                style={previewStickyStyle}
              >
                {displayedThumbnailUrl ? (
                  <div className="videoPreviewWrapper">
                    <img
                      src={displayedThumbnailUrl}
                      alt="Playlist thumbnail"
                      style={{
                        width: "100%",
                        aspectRatio: "16 / 9",
                        borderRadius: "8px",
                        objectFit: "cover",
                      }}
                    />
                  </div>
                ) : (
                  <div className="videoPreviewWrapper">
                    <img
                      src={DefaultThumbnail}
                      alt="Default playlist thumbnail"
                      style={{
                        width: "100%",
                        aspectRatio: "16 / 9",
                        borderRadius: "8px",
                        objectFit: "cover",
                      }}
                    />
                  </div>
                )}

                <div className="videoPreviewInfo">
                  <h3 className="videoPreviewTitle">
                    {title || "Untitled Playlist"}
                  </h3>
                  <p className="videoPreviewDuration">
                    {playlistVideos.length} videos
                  </p>
                  <div className="mt-2 text-sm opacity-80">
                    {formatDescription(description)}
                  </div>
                </div>
              </div>
            </aside>

            <div className="stepContentMain">
              <div className="videoDetailsForm">
                <section className="editSection">
                  <h2 className="editSectionTitle">Thumbnail</h2>

                  <div
                    className={`uploadZone ${pendingThumbnailFile ? "hasFile" : ""}`}
                    onClick={() =>
                      !pendingThumbnailFile && fileInputRef.current?.click()
                    }
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      onChange={handleFileSelect}
                      hidden
                    />
                    {pendingThumbnailFile ? (
                      <div className="fileInfo">
                        {UploadSVG}
                        <p className="fileName">{pendingThumbnailFile.name}</p>
                        <p className="fileSize">
                          {(pendingThumbnailFile.size / (1024 * 1024)).toFixed(
                            2
                          )}{" "}
                          MB
                        </p>
                        <button
                          type="button"
                          className="removeFileBtn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveThumbnail();
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="uploadPrompt">
                        {UploadSVG}
                        <p>Select thumbnail image</p>
                        <span>PNG, JPG, WEBP and similar image formats</span>
                        <button type="button" className="selectFileBtn">
                          Select file
                        </button>
                      </div>
                    )}
                  </div>

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
                            {thumbnailMarkedForRemoval ? "Saving..." : "Uploading..."}
                          </>
                        ) : (
                          "Save Thumbnail"
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
                        {pendingThumbnailFile ? "Clear Selection" : "Remove Thumbnail"}
                      </button>
                      {thumbnailModified && (
                        <button
                          type="button"
                          onClick={resetThumbnailSelection}
                          className="cancelBtn thumbnailCancelBtn"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <p className="formHint thumbnailHint">
                      {thumbnailModified ? (
                        <span className="unsavedIndicator">
                          • Unsaved thumbnail changes
                        </span>
                      ) : (
                        "Select a new image, then save it explicitly."
                      )}
                    </p>
                  </div>
                </section>

                <section className="editSection">
                  <h2 className="editSectionTitle">Playlist Details</h2>

                  <div className="formGroup">
                    <label htmlFor="playlistTitle">Title</label>
                    <input
                      id="playlistTitle"
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Enter playlist title"
                      maxLength={100}
                    />
                    <span className="charCount">{title.length}/100</span>
                  </div>

                  <div className="formGroup">
                    <label htmlFor="playlistDescription">Description</label>
                    <textarea
                      id="playlistDescription"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Enter playlist description"
                      rows={5}
                      maxLength={5000}
                    />
                    <span className="charCount">{description.length}/5000</span>
                  </div>

                  <div className="formGroup">
                    <label htmlFor="playlistTags">Tags</label>
                    <div className="tagsContainer">
                      {tags.map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                          <button
                            type="button"
                            className="removeTagBtn"
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
                          tags.length === 0 ? "Press Enter to add tags" : ""
                        }
                      />
                    </div>
                  </div>

                  <div className="formGroup mt-7.5 mb-5">
                    <label htmlFor="playlistStatus">Visibility</label>
                    <select
                      id="playlistStatus"
                      value={status}
                      onChange={(e) =>
                        setStatus(e.target.value as "public" | "private")
                      }
                      className="visibilitySelect"
                    >
                      <option value="public">Public</option>
                      <option value="private">Private</option>
                    </select>
                    <p className="formHint">
                      {status === "public"
                        ? "Anyone can view this playlist."
                        : "Only users with access can view this playlist."}
                    </p>
                  </div>

                  <div className="formGroup mt-7.5 mb-5">
                    <label htmlFor="playlistFeatured">Featured</label>
                    <select
                      id="playlistFeatured"
                      value={featured ? "true" : "false"}
                      onChange={(e) => setFeatured(e.target.value === "true")}
                      className="visibilitySelect"
                    >
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </select>
                    <p className="formHint">
                      Featured playlists can be highlighted in the app.
                    </p>
                  </div>

                  <div className="captionsActions">
                    <p className="formHint">
                      {detailsModified && (
                        <span className="unsavedIndicator">
                          • Unsaved changes
                        </span>
                      )}
                    </p>
                    <div className="captionsButtonGroup">
                      <button
                        type="button"
                        onClick={handleSaveDetails}
                        disabled={!detailsModified || isSavingDetails}
                        className="saveCaptionsBtn"
                      >
                        {isSavingDetails ? (
                          <>
                            <div className="uploadSpinner tiny" />
                            Saving...
                          </>
                        ) : (
                          "Save Details"
                        )}
                      </button>
                    </div>
                  </div>
                </section>

                <section className="editSection">
                  <h2 className="editSectionTitle">Playlist Videos</h2>

                  <div className="formGroup">
                    <label htmlFor="playlistVideoSearch">Add video</label>
                    <input
                      id="playlistVideoSearch"
                      type="text"
                      className="playlistVideoSearchInput"
                      value={playlistVideoSearch}
                      onChange={(e) => setPlaylistVideoSearch(e.target.value)}
                      placeholder="Search videos to add to this playlist"
                    />

                    <div className="playlistVideoSearchBlock">
                      {debouncedPlaylistVideoSearch && (
                        <div className="playlistVideoSearchResults">
                          {isSearchingPlaylistVideos ? (
                            <p className="formHint">Searching videos...</p>
                          ) : filteredSearchVideos.length ? (
                            filteredSearchVideos.map((video) => (
                              <div
                                key={video.id}
                                className="playlistVideoSearchRow"
                              >
                                <div className="playlistVideoSearchInfo">
                                  <img
                                    src={video.thumbnail_url}
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
                                  disabled={isAddingVideoId === video.id}
                                >
                                  {isAddingVideoId === video.id ? (
                                    <>
                                      <div className="uploadSpinner tiny" />
                                      Adding...
                                    </>
                                  ) : (
                                    <>
                                      {AddSVG}
                                      Add
                                    </>
                                  )}
                                </button>
                              </div>
                            ))
                          ) : (
                            <p className="formHint">
                              No videos found, or all matching videos are already in
                              this playlist.
                            </p>
                          )}
                        </div>
                      )}

                      <div className="playlistVideoSearchDivider" />
                    </div>
                  </div>

                  <div className="formGroup">
                    {playlistVideos.length ? (
                      <>
                        <div className="playlistVideoEditorList">
                          {playlistVideos.map((video, index) => (
                            <div
                              key={video.id}
                              className={`playlistVideoEditorRow ${
                                draggedVideoId === video.id ? "dragging" : ""
                              } ${
                                dragOverVideoId === video.id &&
                                draggedVideoId !== video.id
                                  ? "dragOver"
                                  : ""
                              }`}
                              onDragEnter={() =>
                                handlePlaylistVideoDragEnter(video.id)
                              }
                              onDragOver={(e) =>
                                handlePlaylistVideoDragOver(e, video.id)
                              }
                              onDrop={(e) =>
                                handlePlaylistVideoDrop(e, video.id)
                              }
                            >
                              <button
                                type="button"
                                draggable
                                aria-label={`Reorder ${video.title}`}
                                className="playlistVideoDragHandle"
                                disabled={
                                  isReorderingPlaylistVideos ||
                                  !!isDeletingVideoId ||
                                  !!isAddingVideoId
                                }
                                onDragStart={(e) =>
                                  handlePlaylistVideoDragStart(e, video.id)
                                }
                                onDragEnd={handlePlaylistVideoDragEnd}
                              >
                                <span />
                                <span />
                                <span />
                              </button>
                              <Link
                                to={`/video/${video.id}`}
                                className="playlistVideoEditorLink"
                              >
                                <PlaylistVideoRowContent
                                  video={video}
                                  index={index}
                                />
                              </Link>
                              <button
                                type="button"
                                className="playlistVideoDeleteBtn"
                                aria-label={`Delete ${video.title} from playlist`}
                                onClick={() => handleDeletePlaylistVideo(video.id)}
                                disabled={
                                  isDeletingVideoId === video.id ||
                                  isReorderingPlaylistVideos
                                }
                              >
                                {isDeletingVideoId === video.id ? (
                                  <div className="uploadSpinner tiny" />
                                ) : (
                                  DeleteSVG
                                )}
                              </button>
                            </div>
                          ))}
                        </div>

                        <div className="captionsActions">
                          <p className="formHint">
                            {isReorderingPlaylistVideos ? (
                              <span className="unsavedIndicator">
                                {"\u2022"} Saving playlist order...
                              </span>
                            ) : (
                              "Drag videos by the handle to reorder them. Changes are saved immediately."
                            )}
                          </p>
                        </div>
                      </>
                    ) : (
                      <p className="formHint">This playlist has no videos.</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        <section ref={previewBoundaryRef} className="bottomBtns">
          <button
            type="button"
            className="cancelBtn"
            onClick={() => navigate("/my-playlists")}
          >
            Back to My Playlists
          </button>
          <Link to={`/playlist/${playlistId}`} className="uploadBtn">
            View Playlist
          </Link>
        </section>
      </div>
    </main>
  );
}

export default EditPlaylistPage;
