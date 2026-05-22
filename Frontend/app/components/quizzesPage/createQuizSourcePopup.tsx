import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import type { PlaylistSearchRes, SearchT } from "~/types";
import type {
  CreateQuizSourcePayload,
  QuizQuestionSourceType,
  SourceDraftValues,
} from "./quizTypes";

type Props = {
  open: boolean;
  requestHeaders: Headers;
  mode?: "create" | "edit";
  initialValues?: SourceDraftValues | null;
  onClose: () => void;
  onSubmit: (payload: CreateQuizSourcePayload) => Promise<void>;
};

type SearchVideo = SearchT["videos"][number];
type SearchPlaylist = PlaylistSearchRes["playlists"][number];

type PlaylistDetailsResponse =
  | SearchPlaylist
  | {
      playlist?: SearchPlaylist;
      success?: boolean;
    };

type VideoDetailsResponse =
  | SearchVideo
  | {
      id: string;
      title: string;
      thumbnail_url: string;
      uploader_name?: string;
    };

const SOURCE_TYPE_OPTIONS: Array<{
  value: QuizQuestionSourceType;
  label: string;
  description: string;
}> = [
  {
    value: "playlist",
    label: "Playlist",
    description: "Generate quiz questions from a selected playlist.",
  },
  {
    value: "video",
    label: "Video",
    description: "Generate quiz questions from a selected video.",
  },
];

function normalizePlaylistDetails(response: PlaylistDetailsResponse | undefined) {
  if (!response) return null;
  if ("playlist" in response && response.playlist) return response.playlist;
  if ("id" in response) return response;
  return null;
}

function normalizeVideoDetails(response: VideoDetailsResponse | undefined): SearchVideo | null {
  if (!response?.id) return null;

  return {
    id: response.id,
    title: response.title,
    thumbnail_url: response.thumbnail_url,
    uploader_name: response.uploader_name ?? "",
    created_at: "created_at" in response ? response.created_at : "",
    duration_seconds: "duration_seconds" in response ? response.duration_seconds : 0,
    percentage_watched: "percentage_watched" in response ? response.percentage_watched : 0,
    progress_seconds: "progress_seconds" in response ? response.progress_seconds : 0,
    view_count: "view_count" in response ? response.view_count : 0,
    people: "people" in response ? response.people : [],
    similarity_score: "similarity_score" in response ? response.similarity_score : 0,
  };
}

function CreateQuizSourcePopup({
  open,
  requestHeaders,
  mode = "create",
  initialValues,
  onClose,
  onSubmit,
}: Props) {
  const DURATION = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [sourceType, setSourceType] = useState<QuizQuestionSourceType>("playlist");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState("");
  const [debouncedSourceSearch, setDebouncedSourceSearch] = useState("");
  const [percentage, setPercentage] = useState("80");
  const [includeGeneralQuestions, setIncludeGeneralQuestions] = useState(false);
  const [fixedQuestionCount, setFixedQuestionCount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const isEditMode = mode === "edit";

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSourceSearch(sourceSearch.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [sourceSearch]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }

      const nextSourceType = initialValues?.source_type ?? "playlist";

      setMounted(true);
      setVisible(false);
      setSourceType(nextSourceType);
      setSelectedPlaylistId(initialValues?.playlist_id ?? null);
      setSelectedVideoId(initialValues?.video_id ?? null);
      setSourceSearch("");
      setDebouncedSourceSearch("");
      setPercentage(initialValues?.percentage ?? "80");
      setIncludeGeneralQuestions(initialValues?.include_general_questions ?? false);
      setFixedQuestionCount(initialValues?.fixed_question_count ?? "");
      setError(null);
      setIsSubmitting(false);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
          searchInputRef.current?.focus();
        });
      });
      return;
    }

    setVisible(false);
    closeTimeoutRef.current = window.setTimeout(() => setMounted(false), DURATION);
  }, [initialValues, open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSubmitting, onClose, open]);

  const { data: playlistSearchData, isFetching: isSearchingPlaylists } = useQuery({
    queryKey: ["quiz-source-playlist-search", debouncedSourceSearch],
    queryFn: () =>
      fetchFn<PlaylistSearchRes>({
        route: `api/playlists/search?q=${encodeURIComponent(debouncedSourceSearch)}`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    enabled: open && sourceType === "playlist" && debouncedSourceSearch.length > 0,
    refetchOnWindowFocus: false,
  });

  const { data: videoSearchData, isFetching: isSearchingVideos } = useQuery({
    queryKey: ["quiz-source-video-search", debouncedSourceSearch],
    queryFn: () =>
      fetchFn<SearchT>({
        route: `api/videos/search?q=${encodeURIComponent(debouncedSourceSearch)}`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    enabled: open && sourceType === "video" && debouncedSourceSearch.length > 0,
    refetchOnWindowFocus: false,
  });

  const { data: selectedPlaylistDetailsResponse } = useQuery({
    queryKey: ["quiz-source-selected-playlist", selectedPlaylistId],
    queryFn: () =>
      fetchFn<PlaylistDetailsResponse>({
        route: `api/playlists/${selectedPlaylistId}`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    enabled: open && sourceType === "playlist" && !!selectedPlaylistId,
    refetchOnWindowFocus: false,
  });

  const { data: selectedVideoDetailsResponse } = useQuery({
    queryKey: ["quiz-source-selected-video", selectedVideoId],
    queryFn: () =>
      fetchFn<VideoDetailsResponse>({
        route: `api/videos/${selectedVideoId}`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    enabled: open && sourceType === "video" && !!selectedVideoId,
    refetchOnWindowFocus: false,
  });

  const searchPlaylists = useMemo(
    () => playlistSearchData?.playlists ?? [],
    [playlistSearchData?.playlists]
  );
  const searchVideos = useMemo(() => videoSearchData?.videos ?? [], [videoSearchData?.videos]);
  const selectedPlaylistDetails = normalizePlaylistDetails(selectedPlaylistDetailsResponse);
  const selectedVideoDetails = normalizeVideoDetails(selectedVideoDetailsResponse);

  const selectedPlaylist = useMemo<SearchPlaylist | null>(() => {
    if (!selectedPlaylistId) return null;

    const searchMatch = searchPlaylists.find((playlist) => playlist.id === selectedPlaylistId);
    if (searchMatch) return searchMatch;
    if (selectedPlaylistDetails) return selectedPlaylistDetails;

    return {
      id: selectedPlaylistId,
      title: selectedPlaylistId,
      thumbnail_url: "",
      view_count: 0,
      video_count: 0,
      created_at: "",
      description: "",
    };
  }, [searchPlaylists, selectedPlaylistDetails, selectedPlaylistId]);

  const selectedVideo = useMemo<SearchVideo | null>(() => {
    if (!selectedVideoId) return null;

    const searchMatch = searchVideos.find((video) => video.id === selectedVideoId);
    if (searchMatch) return searchMatch;
    if (selectedVideoDetails) return selectedVideoDetails;

    return {
      id: selectedVideoId,
      title: selectedVideoId,
      thumbnail_url: "",
      uploader_name: "",
      created_at: "",
      duration_seconds: 0,
      percentage_watched: 0,
      progress_seconds: 0,
      view_count: 0,
      people: [],
      similarity_score: 0,
    };
  }, [searchVideos, selectedVideoDetails, selectedVideoId]);

  const filteredSearchPlaylists = useMemo(
    () => searchPlaylists.filter((playlist) => playlist.id !== selectedPlaylistId),
    [searchPlaylists, selectedPlaylistId]
  );
  const filteredSearchVideos = useMemo(
    () => searchVideos.filter((video) => video.id !== selectedVideoId),
    [searchVideos, selectedVideoId]
  );

  const selectedSourceType = SOURCE_TYPE_OPTIONS.find((option) => option.value === sourceType);
  const isSearchingSources = sourceType === "playlist" ? isSearchingPlaylists : isSearchingVideos;

  const parsePercentage = (value: string) => {
    const parsed = Number.parseFloat(value);

    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      throw new Error("Percentage is required.");
    }

    if (parsed < 1 || parsed > 100) {
      throw new Error("Percentage must be between 1 and 100.");
    }

    return parsed;
  };

  const parseOptionalPositiveInteger = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return null;

    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 1) {
      throw new Error("Fixed question count must be at least 1.");
    }

    return parsed;
  };

  const handleSourceTypeChange = (nextType: QuizQuestionSourceType) => {
    setSourceType(nextType);
    setSourceSearch("");
    setDebouncedSourceSearch("");
    setSelectedPlaylistId(null);
    setSelectedVideoId(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      if (sourceType === "playlist" && !selectedPlaylistId) {
        throw new Error("Select a playlist source.");
      }

      if (sourceType === "video" && !selectedVideoId) {
        throw new Error("Select a video source.");
      }

      const payload: CreateQuizSourcePayload = {
        source_type: sourceType,
        percentage: parsePercentage(percentage),
        include_general_questions: includeGeneralQuestions,
      };

      if (sourceType === "playlist") {
        payload.playlist_id = selectedPlaylistId;
      }

      if (sourceType === "video") {
        payload.video_id = selectedVideoId;
      }

      payload.fixed_question_count = parseOptionalPositiveInteger(fixedQuestionCount);

      setError(null);
      setIsSubmitting(true);
      await onSubmit(payload);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save source.";
      setError(message);
      setIsSubmitting(false);
    }
  };

  const renderThumbnail = (src: string | undefined, alt: string) => {
    if (!src) {
      return (
        <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-xl bg-(--background1) text-xs opacity-70">
          No thumb
        </div>
      );
    }

    return <img src={src} alt={alt} className="h-14 w-24 shrink-0 rounded-xl object-cover" />;
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={isEditMode ? "Edit source" : "Create source"}
      onMouseDown={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className={`absolute inset-0 bg-black/65 transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`relative flex max-h-[min(760px,calc(100vh-48px))] w-[min(720px,94vw)] flex-col overflow-hidden rounded-3xl border border-(--border1) bg-(--background1) p-6 shadow-2xl transition-all duration-200 ease-out ${
          visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="quizPopupHeader">
          <div>
            <h3 className="text-xl font-semibold">
              {isEditMode ? "Edit Source" : "Add Source"}
            </h3>
            <p className="mt-2 text-sm opacity-80">
              Choose a playlist or video source for generated quiz questions.
            </p>
          </div>
        </div>

        <form className="quizPopupForm" onSubmit={handleSubmit}>
          <div className="quizPopupBody">
            <div className="quizPopupGrid">
              <div className="formGroup">
                <label htmlFor="quizSourceType">Source Type</label>
                <select
                  id="quizSourceType"
                  value={sourceType}
                  onChange={(event) =>
                    handleSourceTypeChange(event.target.value as QuizQuestionSourceType)
                  }
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                >
                  {SOURCE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="formGroup">
                <label htmlFor="quizSourcePercentage">Percentage</label>
                <input
                  id="quizSourcePercentage"
                  type="number"
                  min={1}
                  max={100}
                  step={0.01}
                  value={percentage}
                  onChange={(event) => setPercentage(event.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                />
              </div>
            </div>

            <div className="rounded-3xl border border-(--border1) bg-(--background2) px-4 py-3 text-sm opacity-80">
              {selectedSourceType?.description ?? "Configure this source."}
            </div>

            <div className="formGroup">
              <label htmlFor="quizSourceSearch">
                {sourceType === "playlist" ? "Source Playlist" : "Source Video"}
              </label>
              <div className="mt-3 rounded-3xl border border-(--border1) bg-(--background2) p-4">
                <input
                  ref={searchInputRef}
                  id="quizSourceSearch"
                  type="text"
                  value={sourceSearch}
                  onChange={(event) => setSourceSearch(event.target.value)}
                  placeholder={
                    sourceType === "playlist"
                      ? "Search playlists to use as a source"
                      : "Search videos to use as a source"
                  }
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background1) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                />

                {sourceType === "playlist" ? (
                  selectedPlaylist ? (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-(--border1) bg-(--background1) p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {renderThumbnail(selectedPlaylist.thumbnail_url, selectedPlaylist.title)}
                        <span className="flex min-w-0 flex-col gap-1">
                          <strong className="line-clamp-2">{selectedPlaylist.title}</strong>
                          <span className="text-sm opacity-80">
                            {selectedPlaylist.video_count} videos
                          </span>
                        </span>
                      </div>
                      <button
                        type="button"
                        className="deleteCaptionsBtn"
                        onClick={() => setSelectedPlaylistId(null)}
                        disabled={isSubmitting}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-dashed border-(--border1) bg-(--background1) px-4 py-3 text-sm opacity-75">
                      No playlist selected.
                    </div>
                  )
                ) : selectedVideo ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-(--border1) bg-(--background1) p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {renderThumbnail(selectedVideo.thumbnail_url, selectedVideo.title)}
                      <span className="flex min-w-0 flex-col gap-1">
                        <strong className="line-clamp-2">{selectedVideo.title}</strong>
                        <span className="text-sm opacity-80">
                          {selectedVideo.uploader_name || selectedVideo.id}
                        </span>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="deleteCaptionsBtn"
                      onClick={() => setSelectedVideoId(null)}
                      disabled={isSubmitting}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-(--border1) bg-(--background1) px-4 py-3 text-sm opacity-75">
                    No video selected.
                  </div>
                )}

                {debouncedSourceSearch ? (
                  <div className="mt-3 grid gap-3">
                    {isSearchingSources ? (
                      <p className="text-sm opacity-75">
                        Searching {sourceType === "playlist" ? "playlists" : "videos"}...
                      </p>
                    ) : sourceType === "playlist" ? (
                      filteredSearchPlaylists.length ? (
                        filteredSearchPlaylists.map((playlist) => (
                          <div
                            key={playlist.id}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-(--border1) bg-(--background1) p-3"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              {renderThumbnail(playlist.thumbnail_url, playlist.title)}
                              <span className="flex min-w-0 flex-col gap-1">
                                <strong className="line-clamp-2">{playlist.title}</strong>
                                <span className="text-sm opacity-80">
                                  {playlist.video_count} videos
                                </span>
                              </span>
                            </div>

                            <button
                              type="button"
                              className="saveCaptionsBtn"
                              onClick={() => {
                                setSelectedPlaylistId(playlist.id);
                                setSourceSearch("");
                                setDebouncedSourceSearch("");
                              }}
                              disabled={isSubmitting}
                            >
                              Select
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm opacity-75">No playlists found.</p>
                      )
                    ) : filteredSearchVideos.length ? (
                      filteredSearchVideos.map((video) => (
                        <div
                          key={video.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-(--border1) bg-(--background1) p-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {renderThumbnail(video.thumbnail_url, video.title)}
                            <span className="flex min-w-0 flex-col gap-1">
                              <strong className="line-clamp-2">{video.title}</strong>
                              <span className="text-sm opacity-80">{video.uploader_name}</span>
                            </span>
                          </div>

                          <button
                            type="button"
                            className="saveCaptionsBtn"
                            onClick={() => {
                              setSelectedVideoId(video.id);
                              setSourceSearch("");
                              setDebouncedSourceSearch("");
                            }}
                            disabled={isSubmitting}
                          >
                            Select
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm opacity-75">No videos found.</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="quizPopupGrid">
              <div className="formGroup">
                <label htmlFor="quizSourceFixedQuestionCount">Fixed Question Count</label>
                <input
                  id="quizSourceFixedQuestionCount"
                  type="number"
                  min={1}
                  step={1}
                  value={fixedQuestionCount}
                  onChange={(event) => setFixedQuestionCount(event.target.value)}
                  placeholder="Optional"
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                />
              </div>
            </div>

            <div className="quizPopupToggleList">
              <label className="quizPopupToggleRow" htmlFor="quizSourceIncludeGeneralQuestions">
                <div>
                  <strong>Include General Questions</strong>
                  <span>Allow generated questions that are not tied to a specific timestamp or source item.</span>
                </div>
                <input
                  id="quizSourceIncludeGeneralQuestions"
                  type="checkbox"
                  checked={includeGeneralQuestions}
                  onChange={(event) => setIncludeGeneralQuestions(event.target.checked)}
                  disabled={isSubmitting}
                  className="quizPopupCheckbox appearance-none rounded-[6px]! p-2.25! border-2 cursor-pointer checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                />
              </label>
            </div>

            {error ? <p className="quizPopupError">{error}</p> : null}
          </div>

          <div className="quizPopupActions">
            <button type="button" className="cancelBtn" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="saveCaptionsBtn" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <div className="uploadSpinner tiny" />
                  Saving...
                </>
              ) : isEditMode ? (
                "Save Source"
              ) : (
                "Add Source"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default CreateQuizSourcePopup;
