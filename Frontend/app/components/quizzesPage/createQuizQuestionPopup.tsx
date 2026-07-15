import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import { useI18n } from "~/i18n";
import type { PlaylistSearchRes, SearchT } from "~/types";
import type {
  ChoiceOption,
  CreateQuizQuestionPayload,
  MatchingPair,
  QuestionDraftValues,
  QuestionType,
} from "./quizTypes";

type Props = {
  open: boolean;
  nextPosition: number;
  requestHeaders: Headers;
  mode?: "create" | "edit";
  initialValues?: QuestionDraftValues | null;
  onClose: () => void;
  onSubmit: (payload: CreateQuizQuestionPayload) => Promise<void>;
};

type SearchVideo = SearchT["videos"][number];
type SearchPlaylist = PlaylistSearchRes["playlists"][number];

type PlaylistDetailsResponse =
  | SearchPlaylist
  | {
      playlist?: SearchPlaylist;
      success?: boolean;
    };

const createEmptyOption = (): ChoiceOption => ({
  option_text: "",
  is_correct: false,
});

const createEmptyPair = (): MatchingPair => ({
  left_text: "",
  right_text: "",
});

function normalizePlaylistDetails(response: PlaylistDetailsResponse | undefined) {
  if (!response) return null;
  if ("playlist" in response && response.playlist) return response.playlist;
  if ("id" in response) return response;
  return null;
}

function CreateQuizQuestionPopup({
  open,
  nextPosition,
  requestHeaders,
  mode = "create",
  initialValues,
  onClose,
  onSubmit,
}: Props) {
  const { t } = useI18n();
  const questionTypeOptions = useMemo<Array<{ value: QuestionType; label: string }>>(
    () => [
      { value: "single_choice", label: t("quizSingleChoice") },
      { value: "multiple_choice", label: t("quizMultipleChoice") },
      { value: "matching", label: t("quizMatching") },
    ],
    [t]
  );
  const DURATION = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [questionText, setQuestionText] = useState("");
  const [questionType, setQuestionType] = useState<QuestionType>("single_choice");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [videoSearch, setVideoSearch] = useState("");
  const [debouncedVideoSearch, setDebouncedVideoSearch] = useState("");
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [debouncedPlaylistSearch, setDebouncedPlaylistSearch] = useState("");
  const [explanation, setExplanation] = useState("");
  const [points, setPoints] = useState("1");
  const [options, setOptions] = useState<ChoiceOption[]>([
    createEmptyOption(),
    createEmptyOption(),
  ]);
  const [pairs, setPairs] = useState<MatchingPair[]>([createEmptyPair()]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const questionInputRef = useRef<HTMLInputElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const isEditMode = mode === "edit";

  const usesOptions =
    questionType === "single_choice" || questionType === "multiple_choice";

  const resetForm = () => {
    setQuestionText(initialValues?.question_text ?? "");
    setQuestionType(initialValues?.question_type ?? "single_choice");
    setSelectedVideoId(initialValues?.video_id ?? null);
    setSelectedPlaylistId(initialValues?.playlist_id ?? null);
    setVideoSearch("");
    setDebouncedVideoSearch("");
    setPlaylistSearch("");
    setDebouncedPlaylistSearch("");
    setExplanation(initialValues?.explanation ?? "");
    setPoints(String(initialValues?.points ?? 1));
    setOptions(
      initialValues?.options?.length
        ? initialValues.options.map((option) => ({
            option_text: option.option_text,
            is_correct: option.is_correct,
          }))
        : [createEmptyOption(), createEmptyOption()]
    );
    setPairs(
      initialValues?.pairs?.length
        ? initialValues.pairs.map((pair) => ({
            left_text: pair.left_text,
            right_text: pair.right_text,
          }))
        : [createEmptyPair()]
    );
    setError(null);
    setIsSubmitting(false);
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedVideoSearch(videoSearch.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [videoSearch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedPlaylistSearch(playlistSearch.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [playlistSearch]);

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

      setMounted(true);
      setVisible(false);
      resetForm();

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
          questionInputRef.current?.focus();
        });
      });
      return;
    }

    setVisible(false);
    closeTimeoutRef.current = window.setTimeout(() => setMounted(false), DURATION);
  }, [initialValues, nextPosition, open]);

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

  useEffect(() => {
    setError(null);

    if (questionType === "matching") {
      if (!pairs.length) {
        setPairs([createEmptyPair()]);
      }
      return;
    }

    if (options.length < 2) {
      setOptions([createEmptyOption(), createEmptyOption()]);
    }
  }, [options.length, pairs.length, questionType]);

  const { data: videoSearchData, isFetching: isSearchingVideos } = useQuery({
    queryKey: ["quiz-question-video-search", debouncedVideoSearch],
    queryFn: () =>
      fetchFn<SearchT>({
        route: `api/videos/search?q=${encodeURIComponent(debouncedVideoSearch)}`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    enabled: open && debouncedVideoSearch.length > 0,
    refetchOnWindowFocus: false,
  });

  const { data: selectedVideoDetails } = useQuery({
    queryKey: ["quiz-question-selected-video", selectedVideoId],
    queryFn: () =>
      fetchFn<{
        id: string;
        title: string;
        thumbnail_url: string;
        uploader_name?: string;
      }>({
        route: `api/videos/${selectedVideoId}`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    enabled: open && !!selectedVideoId,
    refetchOnWindowFocus: false,
  });

  const { data: playlistSearchData, isFetching: isSearchingPlaylists } = useQuery({
    queryKey: ["quiz-question-playlist-search", debouncedPlaylistSearch],
    queryFn: () =>
      fetchFn<PlaylistSearchRes>({
        route: `api/playlists/search?q=${encodeURIComponent(debouncedPlaylistSearch)}`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    enabled: open && debouncedPlaylistSearch.length > 0,
    refetchOnWindowFocus: false,
  });

  const { data: selectedPlaylistDetailsResponse } = useQuery({
    queryKey: ["quiz-question-selected-playlist", selectedPlaylistId],
    queryFn: () =>
      fetchFn<PlaylistDetailsResponse>({
        route: `api/playlists/${selectedPlaylistId}`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    enabled: open && !!selectedPlaylistId,
    refetchOnWindowFocus: false,
  });

  const searchVideos = useMemo(() => videoSearchData?.videos ?? [], [videoSearchData?.videos]);
  const searchPlaylists = useMemo(
    () => playlistSearchData?.playlists ?? [],
    [playlistSearchData?.playlists]
  );
  const selectedPlaylistDetails = normalizePlaylistDetails(selectedPlaylistDetailsResponse);

  const selectedVideo = useMemo<SearchVideo | null>(() => {
    if (!selectedVideoId) return null;

    const existingSearchVideo = searchVideos.find((video) => video.id === selectedVideoId);
    if (existingSearchVideo) return existingSearchVideo;

    if (!selectedVideoDetails?.id) return null;

    return {
      id: selectedVideoDetails.id,
      title: selectedVideoDetails.title,
      thumbnail_url: selectedVideoDetails.thumbnail_url,
      uploader_name: selectedVideoDetails.uploader_name ?? "",
      created_at: "",
      duration_seconds: 0,
      percentage_watched: 0,
      progress_seconds: 0,
      view_count: 0,
      people: [],
      similarity_score: 0,
    };
  }, [searchVideos, selectedVideoDetails, selectedVideoId]);

  const filteredSearchVideos = useMemo(
    () => searchVideos.filter((video) => video.id !== selectedVideoId),
    [searchVideos, selectedVideoId]
  );

  const selectedPlaylist = useMemo<SearchPlaylist | null>(() => {
    if (!selectedPlaylistId) return null;

    const existingSearchPlaylist = searchPlaylists.find(
      (playlist) => playlist.id === selectedPlaylistId
    );
    if (existingSearchPlaylist) return existingSearchPlaylist;
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

  const filteredSearchPlaylists = useMemo(
    () => searchPlaylists.filter((playlist) => playlist.id !== selectedPlaylistId),
    [searchPlaylists, selectedPlaylistId]
  );

  const parsePositiveInteger = (
    value: string,
    label: string,
    options?: { min?: number }
  ) => {
    const parsed = Number.parseInt(value, 10);
    const min = options?.min ?? 1;

    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      throw new Error(t("quizFieldRequired", { label }));
    }

    if (parsed < min) {
      throw new Error(t("quizFieldMin", { label, min }));
    }

    return parsed;
  };

  const handleOptionChange = (
    index: number,
    key: keyof ChoiceOption,
    value: string | boolean
  ) => {
    setOptions((currentOptions) =>
      currentOptions.map((option, optionIndex) =>
        optionIndex === index ? { ...option, [key]: value } : option
      )
    );
  };

  const handlePairChange = (
    index: number,
    key: keyof MatchingPair,
    value: string
  ) => {
    setPairs((currentPairs) =>
      currentPairs.map((pair, pairIndex) =>
        pairIndex === index ? { ...pair, [key]: value } : pair
      )
    );
  };

  const validatePayload = (payload: CreateQuizQuestionPayload) => {
    if (!payload.question_text.trim()) {
      throw new Error(t("quizFieldRequired", { label: t("quizQuestionText") }));
    }

    if (payload.question_type === "matching") {
      if (!payload.pairs.length) {
        throw new Error(t("quizAddMatchingPairRequired"));
      }

      payload.pairs.forEach((pair, index) => {
        if (!pair.left_text.trim() || !pair.right_text.trim()) {
          throw new Error(t("quizMatchingPairValuesRequired", { number: index + 1 }));
        }
      });

      return;
    }

    if (payload.options.length < 2) {
      throw new Error(t("quizAddTwoOptionsRequired"));
    }

    const trimmedOptions = payload.options.map((option) => option.option_text.trim());
    if (trimmedOptions.some((optionText) => !optionText)) {
      throw new Error(t("quizOptionTextRequired"));
    }

    const correctOptionCount = payload.options.filter((option) => option.is_correct).length;
    if (payload.question_type === "single_choice" && correctOptionCount !== 1) {
      throw new Error(t("quizSingleCorrectRequired"));
    }

    if (payload.question_type === "multiple_choice" && correctOptionCount < 1) {
      throw new Error(t("quizMultipleCorrectRequired"));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      const payload: CreateQuizQuestionPayload = {
        question_text: questionText.trim(),
        question_type: questionType,
        video_id: selectedVideoId,
        playlist_id: selectedPlaylistId,
        explanation: explanation.trim(),
        points: parsePositiveInteger(points, t("quizPoints")),
        position: nextPosition,
        is_active: true,
        options: usesOptions
          ? options.map((option) => ({
              option_text: option.option_text.trim(),
              is_correct: option.is_correct,
            }))
          : [],
        pairs:
          questionType === "matching"
            ? pairs.map((pair) => ({
                left_text: pair.left_text.trim(),
                right_text: pair.right_text.trim(),
              }))
            : [],
      };

      validatePayload(payload);

      setError(null);
      setIsSubmitting(true);
      await onSubmit(payload);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("quizFailedCreateQuestion");
      setError(message);
      setIsSubmitting(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={isEditMode ? t("quizEditQuestion") : t("quizAddQuestion")}
      onMouseDown={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className={`absolute inset-0 bg-(--backgroundC2) transition-opacity duration-200 ${
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
              {isEditMode ? t("quizEditQuestion") : t("quizAddQuestion")}
            </h3>
            <p className="mt-2 text-sm opacity-80">
              {isEditMode
                ? t("quizQuestionEditDescription")
                : t("quizQuestionCreateDescription")}
            </p>
          </div>
        </div>

        <form className="quizPopupForm" onSubmit={handleSubmit}>
          <div className="quizPopupBody">
            <div className="quizPopupGrid">
              <div className="formGroup">
                <label htmlFor="quizQuestionType">{t("quizQuestionType")}</label>
                <select
                  id="quizQuestionType"
                  value={questionType}
                  onChange={(event) => setQuestionType(event.target.value as QuestionType)}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                >
                  {questionTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="formGroup">
                <label htmlFor="quizQuestionPoints">{t("quizPoints")}</label>
                <input
                  id="quizQuestionPoints"
                  type="number"
                  min={1}
                  step={1}
                  value={points}
                  onChange={(event) => setPoints(event.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                />
              </div>
            </div>

            <div className="formGroup">
              <label htmlFor="quizQuestionText">{t("quizQuestionText")}</label>
              <input
                ref={questionInputRef}
                id="quizQuestionText"
                type="text"
                value={questionText}
                onChange={(event) => setQuestionText(event.target.value)}
                placeholder={t("quizQuestionTextPlaceholder")}
                disabled={isSubmitting}
                className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
              />
            </div>

            <div className="formGroup">
              <label htmlFor="quizQuestionVideoSearch">{t("quizConnectedVideo")}</label>
              <div className="mt-3 rounded-3xl border border-(--border1) bg-(--background2) p-4">
                <input
                  id="quizQuestionVideoSearch"
                  type="text"
                  value={videoSearch}
                  onChange={(event) => setVideoSearch(event.target.value)}
                  placeholder={t("quizSearchVideosForQuestion")}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background1) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                />

                {selectedVideo ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-(--border1) bg-(--background1) p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <img
                        src={selectedVideo.thumbnail_url}
                        alt={selectedVideo.title}
                        className="h-14 w-24 rounded-xl object-cover"
                      />
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
                      {t("quizRemove")}
                    </button>
                  </div>
                ) : selectedVideoId ? (
                  <div className="mt-3 rounded-2xl border border-(--border1) bg-(--background1) px-4 py-3 text-sm opacity-75">
                    {t("quizLoadingSelectedVideo")}
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-(--border1) bg-(--background1) px-4 py-3 text-sm opacity-75">
                    {t("quizNoVideoSelected")}
                  </div>
                )}

                {debouncedVideoSearch ? (
                  <div className="mt-3 grid gap-3">
                    {isSearchingVideos ? (
                      <p className="text-sm opacity-75">{t("searchingVideos")}</p>
                    ) : filteredSearchVideos.length ? (
                      filteredSearchVideos.map((video) => (
                        <div
                          key={video.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-(--border1) bg-(--background1) p-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <img
                              src={video.thumbnail_url}
                              alt={video.title}
                              className="h-14 w-24 rounded-xl object-cover"
                            />
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
                              setVideoSearch("");
                              setDebouncedVideoSearch("");
                            }}
                            disabled={isSubmitting}
                          >
                            {t("quizSelect")}
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm opacity-75">{t("quizNoVideosFound")}</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="formGroup">
              <label htmlFor="quizQuestionPlaylistSearch">{t("quizConnectedPlaylist")}</label>
              <div className="mt-3 rounded-3xl border border-(--border1) bg-(--background2) p-4">
                <input
                  id="quizQuestionPlaylistSearch"
                  type="text"
                  value={playlistSearch}
                  onChange={(event) => setPlaylistSearch(event.target.value)}
                  placeholder={t("quizSearchPlaylistsForQuestion")}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background1) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                />

                {selectedPlaylist ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-(--border1) bg-(--background1) p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {selectedPlaylist.thumbnail_url ? (
                        <img
                          src={selectedPlaylist.thumbnail_url}
                          alt={selectedPlaylist.title}
                          className="h-14 w-24 rounded-xl object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-24 items-center justify-center rounded-xl bg-(--background2) text-xs opacity-70">
                          {t("quizNoThumbnail")}
                        </div>
                      )}
                      <span className="flex min-w-0 flex-col gap-1">
                        <strong className="line-clamp-2">{selectedPlaylist.title}</strong>
                        <span className="text-sm opacity-80">
                          {t("videosLabel", { count: selectedPlaylist.video_count })}
                        </span>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="deleteCaptionsBtn"
                      onClick={() => setSelectedPlaylistId(null)}
                      disabled={isSubmitting}
                    >
                      {t("quizRemove")}
                    </button>
                  </div>
                ) : selectedPlaylistId ? (
                  <div className="mt-3 rounded-2xl border border-(--border1) bg-(--background1) px-4 py-3 text-sm opacity-75">
                    {t("quizLoadingSelectedPlaylist")}
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-(--border1) bg-(--background1) px-4 py-3 text-sm opacity-75">
                    {t("quizNoPlaylistSelected")}
                  </div>
                )}

                {debouncedPlaylistSearch ? (
                  <div className="mt-3 grid gap-3">
                    {isSearchingPlaylists ? (
                      <p className="text-sm opacity-75">{t("quizSearchingPlaylists")}</p>
                    ) : filteredSearchPlaylists.length ? (
                      filteredSearchPlaylists.map((playlist) => (
                        <div
                          key={playlist.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-(--border1) bg-(--background1) p-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {playlist.thumbnail_url ? (
                              <img
                                src={playlist.thumbnail_url}
                                alt={playlist.title}
                                className="h-14 w-24 rounded-xl object-cover"
                              />
                            ) : (
                              <div className="flex h-14 w-24 items-center justify-center rounded-xl bg-(--background2) text-xs opacity-70">
                                {t("quizNoThumbnail")}
                              </div>
                            )}
                            <span className="flex min-w-0 flex-col gap-1">
                              <strong className="line-clamp-2">{playlist.title}</strong>
                              <span className="text-sm opacity-80">
                                {t("videosLabel", { count: playlist.video_count })}
                              </span>
                            </span>
                          </div>

                          <button
                            type="button"
                            className="saveCaptionsBtn"
                            onClick={() => {
                              setSelectedPlaylistId(playlist.id);
                              setPlaylistSearch("");
                              setDebouncedPlaylistSearch("");
                            }}
                            disabled={isSubmitting}
                          >
                            {t("quizSelect")}
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm opacity-75">{t("quizNoPlaylistsFound")}</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="formGroup">
              <label htmlFor="quizQuestionExplanation">{t("quizExplanation")}</label>
              <textarea
                id="quizQuestionExplanation"
                value={explanation}
                onChange={(event) => setExplanation(event.target.value)}
                placeholder={t("quizExplanationPlaceholder")}
                rows={3}
                disabled={isSubmitting}
                className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
              />
            </div>

            {usesOptions ? (
              <div className="rounded-3xl border border-(--border1) bg-(--background2) p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold">{t("quizOptions")}</h4>
                    <p className="mt-1 text-sm opacity-75">
                      {questionType === "single_choice"
                        ? t("quizSingleCorrectHelp")
                        : t("quizMultipleCorrectHelp")}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="saveCaptionsBtn"
                    onClick={() =>
                      setOptions((currentOptions) => [...currentOptions, createEmptyOption()])
                    }
                    disabled={isSubmitting}
                  >
                    {t("quizAddOption")}
                  </button>
                </div>

                <div className="grid gap-3">
                  {options.map((option, index) => (
                    <div
                      key={`option-${index}`}
                      className="grid gap-3 rounded-2xl border border-(--border1) bg-(--background1) p-4 md:grid-cols-[minmax(0,1fr)_auto_auto]"
                    >
                      <input
                        type="text"
                        value={option.option_text}
                        onChange={(event) =>
                          handleOptionChange(index, "option_text", event.target.value)
                        }
                        placeholder={t("quizOptionNumber", { number: index + 1 })}
                        disabled={isSubmitting}
                        className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                      />
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          checked={option.is_correct}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            if (questionType === "single_choice" && checked) {
                              setOptions((currentOptions) =>
                                currentOptions.map((currentOption, currentIndex) => ({
                                  ...currentOption,
                                  is_correct: currentIndex === index,
                                }))
                              );
                              return;
                            }

                            handleOptionChange(index, "is_correct", checked);
                          }}
                          disabled={isSubmitting}
                          className="appearance-none rounded-lg! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-(--text1) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                        />
                        {t("quizCorrect")}
                      </label>
                      <button
                        type="button"
                        className="deleteCaptionsBtn"
                        onClick={() =>
                          setOptions((currentOptions) =>
                            currentOptions.length <= 2
                              ? currentOptions
                              : currentOptions.filter((_, optionIndex) => optionIndex !== index)
                          )
                        }
                        disabled={isSubmitting || options.length <= 2}
                      >
                        {t("quizRemove")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-3xl border border-(--border1) bg-(--background2) p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold">{t("quizMatchingPairs")}</h4>
                    <p className="mt-1 text-sm opacity-75">
                      {t("quizMatchingPairsHelp")}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="saveCaptionsBtn"
                    onClick={() =>
                      setPairs((currentPairs) => [...currentPairs, createEmptyPair()])
                    }
                    disabled={isSubmitting}
                  >
                    {t("quizAddPair")}
                  </button>
                </div>

                <div className="grid gap-3">
                  {pairs.map((pair, index) => (
                    <div
                      key={`pair-${index}`}
                      className="grid gap-3 rounded-2xl border border-(--border1) bg-(--background1) p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                    >
                      <input
                        type="text"
                        value={pair.left_text}
                        onChange={(event) =>
                          handlePairChange(index, "left_text", event.target.value)
                        }
                        placeholder={t("quizLeftTextNumber", { number: index + 1 })}
                        disabled={isSubmitting}
                        className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                      />
                      <input
                        type="text"
                        value={pair.right_text}
                        onChange={(event) =>
                          handlePairChange(index, "right_text", event.target.value)
                        }
                        placeholder={t("quizRightTextNumber", { number: index + 1 })}
                        disabled={isSubmitting}
                        className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                      />
                      <button
                        type="button"
                        className="deleteCaptionsBtn"
                        onClick={() =>
                          setPairs((currentPairs) =>
                            currentPairs.length <= 1
                              ? currentPairs
                              : currentPairs.filter((_, pairIndex) => pairIndex !== index)
                          )
                        }
                        disabled={isSubmitting || pairs.length <= 1}
                      >
                        {t("quizRemove")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error ? <p className="quizPopupError">{error}</p> : null}
          </div>

          <div className="quizPopupActions">
            <button type="button" className="cancelBtn" onClick={onClose} disabled={isSubmitting}>
              {t("adminCancel")}
            </button>
            <button type="submit" className="saveCaptionsBtn" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <div className="uploadSpinner tiny" />
                  {t("saving")}
                </>
              ) : isEditMode ? (
                t("quizSaveQuestion")
              ) : (
                t("quizAddQuestion")
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default CreateQuizQuestionPopup;
