import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import type { SearchT } from "~/types";
import type {
  CreateQuizRulePayload,
  QuizRuleType,
  RuleDraftValues,
} from "./quizTypes";

type Props = {
  open: boolean;
  requestHeaders: Headers;
  mode?: "create" | "edit";
  initialValues?: RuleDraftValues | null;
  onClose: () => void;
  onSubmit: (payload: CreateQuizRulePayload) => Promise<void>;
};

type SearchVideo = SearchT["videos"][number];

const RULE_TYPE_OPTIONS: Array<{ value: QuizRuleType; label: string; description: string }> = [
  {
    value: "video_watch_percentage",
    label: "Video Watch Percentage",
    description: "Require users to watch a percentage of a selected video.",
  },
  {
    value: "video_watch_seconds",
    label: "Video Watch Seconds",
    description: "Require users to watch a fixed number of seconds of a selected video.",
  },
];

function CreateQuizRulePopup({
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
  const [ruleType, setRuleType] = useState<QuizRuleType>("video_watch_percentage");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [videoSearch, setVideoSearch] = useState("");
  const [debouncedVideoSearch, setDebouncedVideoSearch] = useState("");
  const [requiredPercentage, setRequiredPercentage] = useState("80");
  const [requiredSeconds, setRequiredSeconds] = useState("120");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const isEditMode = mode === "edit";

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedVideoSearch(videoSearch.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [videoSearch]);

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
      setRuleType(initialValues?.rule_type ?? "video_watch_percentage");
      setSelectedVideoId(initialValues?.video_id ?? null);
      setVideoSearch("");
      setDebouncedVideoSearch("");
      setRequiredPercentage(initialValues?.required_percentage ?? "80");
      setRequiredSeconds(initialValues?.required_seconds ?? "120");
      setIsActive(initialValues?.is_active ?? true);
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

  const { data: videoSearchData, isFetching: isSearchingVideos } = useQuery({
    queryKey: ["quiz-rule-video-search", debouncedVideoSearch],
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
    queryKey: ["quiz-rule-selected-video", selectedVideoId],
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

  const searchVideos = useMemo(() => videoSearchData?.videos ?? [], [videoSearchData?.videos]);

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

  const selectedRuleType = RULE_TYPE_OPTIONS.find((option) => option.value === ruleType);

  const parsePositiveInteger = (
    value: string,
    label: string,
    options?: { min?: number; max?: number }
  ) => {
    const parsed = Number.parseInt(value, 10);
    const min = options?.min ?? 1;
    const max = options?.max;

    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      throw new Error(`${label} is required.`);
    }

    if (parsed < min) {
      throw new Error(`${label} must be at least ${min}.`);
    }

    if (typeof max === "number" && parsed > max) {
      throw new Error(`${label} must be ${max} or less.`);
    }

    return parsed;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      if (!selectedVideoId) {
        throw new Error("Select a video for this rule.");
      }

      const payload: CreateQuizRulePayload = {
        rule_type: ruleType,
        video_id: selectedVideoId,
        is_active: isActive,
      };

      if (ruleType === "video_watch_percentage") {
        payload.required_percentage = parsePositiveInteger(
          requiredPercentage,
          "Required percentage",
          { min: 1, max: 100 }
        );
      }

      if (ruleType === "video_watch_seconds") {
        payload.required_seconds = parsePositiveInteger(
          requiredSeconds,
          "Required seconds",
          { min: 1 }
        );
      }

      setError(null);
      setIsSubmitting(true);
      await onSubmit(payload);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save rule.";
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
      aria-label={isEditMode ? "Edit rule" : "Create rule"}
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
              {isEditMode ? "Edit Rule" : "Add Rule"}
            </h3>
            <p className="mt-2 text-sm opacity-80">
              {isEditMode
                ? "Update the rule fields and save your changes."
                : "Set up a quiz access rule using the same API structure you shared."}
            </p>
          </div>
        </div>

        <form className="quizPopupForm" onSubmit={handleSubmit}>
          <div className="quizPopupBody">
            <div className="quizPopupGrid">
              <div className="formGroup">
                <label htmlFor="quizRuleType">Rule Type</label>
                <select
                  id="quizRuleType"
                  value={ruleType}
                  onChange={(event) => setRuleType(event.target.value as QuizRuleType)}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                >
                  {RULE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {ruleType === "video_watch_percentage" ? (
                <div className="formGroup">
                  <label htmlFor="quizRulePercentage">Required Percentage</label>
                  <input
                    id="quizRulePercentage"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={requiredPercentage}
                    onChange={(event) => setRequiredPercentage(event.target.value)}
                    disabled={isSubmitting}
                    className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                  />
                </div>
              ) : (
                <div className="formGroup">
                  <label htmlFor="quizRuleSeconds">Required Seconds</label>
                  <input
                    id="quizRuleSeconds"
                    type="number"
                    min={1}
                    step={1}
                    value={requiredSeconds}
                    onChange={(event) => setRequiredSeconds(event.target.value)}
                    disabled={isSubmitting}
                    className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                  />
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-(--border1) bg-(--background2) px-4 py-3 text-sm opacity-80">
              {selectedRuleType?.description ?? "Configure this rule type."}
            </div>

            <div className="formGroup">
              <label htmlFor="quizRuleVideoSearch">Rule Video</label>
              <div className="mt-3 rounded-3xl border border-(--border1) bg-(--background2) p-4">
                <input
                  ref={searchInputRef}
                  id="quizRuleVideoSearch"
                  type="text"
                  value={videoSearch}
                  onChange={(event) => setVideoSearch(event.target.value)}
                  placeholder="Search videos to use in this rule"
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
                      Remove
                    </button>
                  </div>
                ) : selectedVideoId ? (
                  <div className="mt-3 rounded-2xl border border-(--border1) bg-(--background1) px-4 py-3 text-sm opacity-75">
                    Loading selected video...
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-(--border1) bg-(--background1) px-4 py-3 text-sm opacity-75">
                    No video selected.
                  </div>
                )}

                {debouncedVideoSearch ? (
                  <div className="mt-3 grid gap-3">
                    {isSearchingVideos ? (
                      <p className="text-sm opacity-75">Searching videos...</p>
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

            <div className="quizPopupToggleList">
              <label className="quizPopupToggleRow" htmlFor="quizRuleIsActive">
                <div>
                  <strong>Is Rule Active</strong>
                  <span>Inactive rules stay saved but will not be enforced.</span>
                </div>
                <input
                  id="quizRuleIsActive"
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
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
                "Save Rule"
              ) : (
                "Add Rule"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default CreateQuizRulePopup;
