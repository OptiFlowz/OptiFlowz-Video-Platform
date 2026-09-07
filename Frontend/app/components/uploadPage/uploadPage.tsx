import { VideoEditorPreview, useVideoPreviewRefresh } from "../shared/videoEditorPreview";
import { ThumbnailImage } from "../shared/thumbnailImage";
import { CaptionStatusMessage } from "../shared/captionStatusMessage";
import { getVideoThumbnail, type VideoMedia } from "../shared/videoMedia";
import { ThumbnailFramePreview } from "../shared/thumbnailFramePreview";
import { Link, useNavigate } from "react-router";
import {
  useState,
  useRef,
  useLayoutEffect,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { AISVG, UploadSVG } from "~/constants";
import { env } from "~/env";
import ContributorSearch from "./contributorSearch";
import { fetchFn } from "~/API";
import { getToken } from "~/functions";
import { EUROPEAN_LANGUAGES, MUX_SPOKEN_LANGUAGES } from "~/constants";
import Sidebar from "../myVideosPage/sidebar/sidebar";
import { useConstrainedSticky } from "../shared/useConstrainedSticky";
import { useI18n } from "~/i18n";
import type { UploadStatus } from "./uploadSession";
import statusStyles from "./uploadStatus.module.css";
import CustomSelect from "~/components/customSelect/customSelect";


import { createThumbnailSettings, type ThumbnailSettings } from "../shared/thumbnailSettings";

interface Contributor {
  id: string;
  name: string;
  image_url?: string;
}

interface Chapter {
  timestamp: string;
  title: string;
}

interface UploadInitiateResponse {
  video_id: string;
  upload: {
    upload_id: string;
    upload_url: string;
  };
}

interface GenerateChaptersResponse {
  chapters: {
    startTime: number;
    title: string;
  }[];
}

interface VideoData extends VideoMedia {
  id: string;
  title: string;
  description: string;
  mux_playback_id: string;
  duration_seconds: number;
  thumbnail_settings?: ThumbnailSettings | null;
  tags: string[];
  chapters: { timestamp: number; title: string }[];
  people: { id: string; name: string; image_url?: string; role: string }[];
}

type ProcessingPhase =
  | "idle"
  | "initializing"
  | "uploading"
  | "processing_asset"
  | "generating_captions"
  | "generating_chapters"
  | "saving_initial_data"
  | "complete";

type CaptionStatus = "loading" | "available" | "not_available" | "generating";

function formatSecondsToTimestamp(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function parseTimestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function formatThumbnailPickerTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00";

  const safeTime = Math.max(0, Number(seconds.toFixed(2)));
  const wholeSeconds = Math.floor(safeTime);
  const fraction = safeTime.toFixed(2).slice(-2).replace(/0+$/, "");
  const suffix = fraction ? `.${fraction}` : "";
  if (wholeSeconds >= 3600) {
    return `${formatSecondsToTimestamp(wholeSeconds)}${suffix}`;
  }
  return `${Math.floor(wholeSeconds / 60).toString().padStart(2, "0")}:${(wholeSeconds % 60).toString().padStart(2, "0")}${suffix}`;
}

function clampThumbnailTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) return 0;
  if (duration <= 0) return Math.max(0, seconds);
  return Math.min(Math.max(seconds, 0), Math.max(duration - 0.1, 0));
}

function parseThumbnailPickerInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(":").map((part) => part.trim());
  if (parts.some((part) => part === "" || Number.isNaN(Number(part)))) {
    return null;
  }

  if (parts.length === 1) {
    return Number(parts[0]);
  }

  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }

  return null;
}

function getInitialThumbnailTime(video?: VideoData | null): number {
  const duration = video?.duration_seconds ?? 0;
  if (video?.thumbnail_settings && Number.isFinite(video.thumbnail_settings.time)) {
    return clampThumbnailTime(video.thumbnail_settings.time, duration);
  }
  return duration > 1 ? Math.min(duration / 3, Math.max(duration - 0.1, 0)) : 0;
}

function UploadPage({ onStatus, onFinish }: { onStatus?: (status: UploadStatus) => void; onFinish?: () => void } = {}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [speakers, setSpeakers] = useState<Contributor[]>([]);
  const [oldSpeakers, setOldSpeakers] = useState<Contributor[]>([]);
  const [chairs, setChairs] = useState<Contributor[]>([]);
  const [oldChairs, setOldChairs] = useState<Contributor[]>([]);
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [captions, setCaptions] = useState("");
  const [oldCaptions, setOldCaptions] = useState("");
  const [spokenLanguage, setSpokenLanguage] = useState("auto");
  const [captionLanguage, setCaptionLanguage] = useState("auto");
  const [playbackPolicy, setPlaybackPolicy] = useState<"public" | "signed">("signed");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [oldChapters, setOldChapters] = useState<Chapter[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [pendingThumbnailFile, setPendingThumbnailFile] = useState<File | null>(
    null
  );
  const [pendingThumbnailUrl, setPendingThumbnailUrl] = useState<string | null>(
    null
  );
  const [thumbnailMarkedForRemoval, setThumbnailMarkedForRemoval] =
    useState(false);
  const [isThumbnailPickerOpen, setIsThumbnailPickerOpen] = useState(false);
  const [selectedThumbnailTime, setSelectedThumbnailTime] = useState(0);
  const [hasPendingVideoFrame, setHasPendingVideoFrame] = useState(false);
  const [thumbnailTimeInput, setThumbnailTimeInput] = useState("00:00");
  const savedThumbnailTime = useRef(0);

  const [videoId, setVideoId] = useState<string | null>(null);
  const { previewRevision, refreshVideoPreview } = useVideoPreviewRefresh(videoId);
  const [processingPhase, setProcessingPhase] =
    useState<ProcessingPhase>("idle");
  const [processingError, setProcessingError] = useState<string | null>(null);

  // Caption status tracking
  const [captionStatus, setCaptionStatus] = useState<CaptionStatus>("loading");
  const [captionsModified, setCaptionsModified] = useState(false);
  const [speakersOrChairsModified, setSpeakersOrChairsModified] =
    useState(false);
  const [chaptersModified, setChaptersModified] = useState(false);
  const [isSavingCaptions, setIsSavingCaptions] = useState(false);
  const [isDeletingCaptions, setIsDeletingCaptions] = useState(false);
  const [isSavingContributors, setIsSavingContributors] = useState(false);
  const [isSavingChapters, setIsSavingChapters] = useState(false);
  const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false);
  const [isRemovingThumbnail, setIsRemovingThumbnail] = useState(false);
  const captionPollingRef = useRef<NodeJS.Timeout | null>(null);
  const previewAsideRef = useRef<HTMLElement | null>(null);
  const previewStickyRef = useRef<HTMLDivElement | null>(null);
  const previewBoundaryRef = useRef<HTMLElement | null>(null);

  // Video details tracking
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);

  const myHeaders = useRef(new Headers());
  const [token, setToken] = useState<string>("");
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const previewStickyStyle = useConstrainedSticky({
    containerRef: previewAsideRef,
    stickyRef: previewStickyRef,
    boundaryRef: previewBoundaryRef,
    disabledBelow: 1420,
    topOffset: 89,
    bottomGap: 24,
  });

  const draftRef = useRef({ chapters, speakers, chairs, captions, captionLanguage });
  draftRef.current = { chapters, speakers, chairs, captions, captionLanguage };
  const chaptersRevision = useRef(0);
  const captionsRevision = useRef(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const mountedRef = useRef(true);

  const isProcessing =
    processingPhase !== "idle" && processingPhase !== "complete";
  const isUploaded = !!videoId && processingPhase === "complete";

  const phaseLabel = processingPhase === "uploading"
    ? `${t("uploadPhaseUploading")} ${uploadProgress}%`
    : processingPhase === "idle" ? "" : t(`uploadPhase_${processingPhase}`);

  useEffect(() => {
    onStatus?.({ label: processingError || phaseLabel, busy: isProcessing, hasDraft: !!videoFile });
  }, [onStatus, phaseLabel, processingError, isProcessing, videoFile]);

  useEffect(() => {
    if (!isProcessing) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [isProcessing]);

  useLayoutEffect(() => {
    const userToken = getToken();
    if (!userToken) return;
    setToken(userToken);

    myHeaders.current = new Headers();
    myHeaders.current.append("Content-Type", "application/json");
    myHeaders.current.append("Authorization", `Bearer ${userToken}`);
  }, []);

  // Fetch video data only after processing is complete
  const { data: videoData, isLoading: isVideoLoading } = useQuery({
    queryKey: [`video${videoId}`],
    queryFn: () =>
      fetchFn({
        route: `api/videos/${videoId}`,
        options: {
          method: "GET",
          headers: myHeaders.current,
          cache: "no-store",
        },
      }) as Promise<VideoData | null>,
    enabled: !!token && !!videoId && processingPhase === "complete",
  });

  useEffect(() => {
    if (!videoData || pendingThumbnailFile || hasPendingVideoFrame || thumbnailMarkedForRemoval) return;
    const initialThumbnailTime = getInitialThumbnailTime(videoData);
    savedThumbnailTime.current = initialThumbnailTime;
    setThumbnailUrl(getVideoThumbnail(videoData) || null);
    setSelectedThumbnailTime(initialThumbnailTime);
    setThumbnailTimeInput(formatThumbnailPickerTime(initialThumbnailTime));
  }, [videoData]);

  useEffect(() => {
    return () => {
      if (pendingThumbnailUrl) {
        URL.revokeObjectURL(pendingThumbnailUrl);
      }
    };
  }, [pendingThumbnailUrl]);

  const displayedThumbnailUrl = thumbnailMarkedForRemoval
    ? null
    : pendingThumbnailUrl || thumbnailUrl;
  const thumbnailModified =
    thumbnailMarkedForRemoval ||
    !!pendingThumbnailFile ||
    !!hasPendingVideoFrame;
  const videoDuration = videoData?.duration_seconds ?? 0;
  const maxThumbnailTime =
    videoDuration > 0 ? Math.max(videoDuration - 0.1, 0) : 0;
  const canChooseVideoFrame = !!videoData?.id && videoDuration > 0;

  const fetchUpdatedThumbnail = async () => {
    const updatedVideo = await fetchFn<VideoData>({
      route: `api/videos/${videoId}`,
      options: { method: "GET", headers: myHeaders.current, cache: "no-store" },
    });
    if (!updatedVideo) throw new Error("Failed to refresh video thumbnail.");
    await refreshVideoPreview();
    return getVideoThumbnail(updatedVideo) || null;
  };

  const uploadThumbnail = async (file: File) => {
    if (!videoId) return false;

    setIsUploadingThumbnail(true);
    setProcessingError(null);

    try {
      const headers = new Headers();
      headers.append("Authorization", `Bearer ${getToken()}`);

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetchFn<{
        success: boolean;
        video?: { thumbnail_url?: string | null };
      }>({
        route: `api/video-moderation/${videoId}/thumbnail`,
        options: {
          method: "POST",
          headers,
          body: formData,
        },
      });

      if (!response?.success) {
        setProcessingError("Failed to upload video thumbnail.");
        return false;
      }

      const clearedSettings = await fetchFn<{ success: boolean }>({
        route: `api/video-moderation/video-details/${videoId}`,
        options: {
          method: "PATCH",
          headers: myHeaders.current,
          body: JSON.stringify({ thumbnail_settings: null }),
        },
      });
      if (!clearedSettings?.success) {
        throw new Error("Failed to clear previous thumbnail settings.");
      }
      savedThumbnailTime.current = 0;
      const nextThumbnailUrl = await fetchUpdatedThumbnail();
      setThumbnailUrl(nextThumbnailUrl);
      setPendingThumbnailFile(null);
      setPendingThumbnailUrl(null);
      setHasPendingVideoFrame(false);
      setThumbnailMarkedForRemoval(false);
      setIsThumbnailPickerOpen(false);
      return true;
    } catch (err) {
      console.error("Error uploading video thumbnail:", err);
      setProcessingError("Failed to upload video thumbnail.");
    } finally {
      setIsUploadingThumbnail(false);
      if (thumbnailInputRef.current) {
        thumbnailInputRef.current.value = "";
      }
    }
    return false;
  };

  const resetThumbnailSelection = () => {
    setPendingThumbnailFile(null);
    setPendingThumbnailUrl(null);
    setHasPendingVideoFrame(false);
    setThumbnailMarkedForRemoval(false);
    const initialThumbnailTime = savedThumbnailTime.current;
    setSelectedThumbnailTime(initialThumbnailTime);
    setThumbnailTimeInput(formatThumbnailPickerTime(initialThumbnailTime));
    setIsThumbnailPickerOpen(false);
    if (thumbnailInputRef.current) {
      thumbnailInputRef.current.value = "";
    }
  };

  const handleThumbnailFileSelect = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPendingThumbnailFile(file);
    setPendingThumbnailUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      return URL.createObjectURL(file);
    });
    setHasPendingVideoFrame(false);
    setThumbnailMarkedForRemoval(false);
    setIsThumbnailPickerOpen(false);
  };

  const handleToggleThumbnailPicker = () => {
    if (!canChooseVideoFrame) return;

    setThumbnailMarkedForRemoval(false);
    setPendingThumbnailFile(null);
    setPendingThumbnailUrl(null);
    if (thumbnailInputRef.current) {
      thumbnailInputRef.current.value = "";
    }

    setIsThumbnailPickerOpen((previousValue) => {
      const nextValue = !previousValue;
      if (nextValue) {
        const initialTime = selectedThumbnailTime;
        setSelectedThumbnailTime(initialTime);
        setThumbnailTimeInput(formatThumbnailPickerTime(initialTime));
        setHasPendingVideoFrame(true);
      } else {
        setHasPendingVideoFrame(false);
      }

      return nextValue;
    });
  };

  const applyThumbnailTime = (nextTime: number) => {
    const clampedTime = clampThumbnailTime(nextTime, videoDuration);
    setSelectedThumbnailTime(clampedTime);
    setThumbnailTimeInput(formatThumbnailPickerTime(clampedTime));

    setHasPendingVideoFrame(true);
  };

  const handleThumbnailTimeChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    applyThumbnailTime(Number(e.target.value));
  };

  const handleThumbnailTimeInputChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setThumbnailTimeInput(e.target.value);
  };

  const commitThumbnailTimeInput = () => {
    const parsedValue = parseThumbnailPickerInput(thumbnailTimeInput);
    if (parsedValue === null) {
      setThumbnailTimeInput(formatThumbnailPickerTime(selectedThumbnailTime));
      return;
    }

    applyThumbnailTime(parsedValue);
  };

  const handleSaveGeneratedThumbnail = async () => {
    if (!videoId || !hasPendingVideoFrame) return false;

    setIsUploadingThumbnail(true);
    setProcessingError(null);

    try {
      const response = await fetchFn<{ success: boolean }>({
        route: `api/video-moderation/video-details/${videoId}`,
        options: {
          method: "PATCH",
          headers: myHeaders.current,
          body: JSON.stringify({
            thumbnail_url: null,
            thumbnail_settings: createThumbnailSettings(selectedThumbnailTime),
          }),
        },
      });

      if (!response?.success) {
        setProcessingError("Failed to save video thumbnail.");
        return false;
      }

      savedThumbnailTime.current = selectedThumbnailTime;
      setThumbnailUrl(await fetchUpdatedThumbnail());
      setHasPendingVideoFrame(false);
      setPendingThumbnailFile(null);
      setPendingThumbnailUrl(null);
      setThumbnailMarkedForRemoval(false);
      setIsThumbnailPickerOpen(false);
      return true;
    } catch (err) {
      console.error("Error saving generated thumbnail:", err);
      setProcessingError("Failed to save video thumbnail.");
    } finally {
      setIsUploadingThumbnail(false);
    }
    return false;
  };

  const handleSaveThumbnail = async () => {
    if (!videoId) return false;

    if (thumbnailMarkedForRemoval) {
      setIsRemovingThumbnail(true);
      setProcessingError(null);

      try {
        const headers = new Headers();
        headers.append("Authorization", `Bearer ${getToken()}`);
        headers.append("Content-Type", "application/json");

        const response = await fetchFn<{ success: boolean }>({
          route: `api/video-moderation/video-details/${videoId}`,
          options: {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              thumbnail_url: null,
              thumbnail_settings: null,
            }),
          },
        });

        if (!response?.success) {
          setProcessingError("Failed to remove video thumbnail.");
          return false;
        }

        savedThumbnailTime.current = 0;
        setThumbnailUrl(await fetchUpdatedThumbnail());
        resetThumbnailSelection();
        return true;
      } catch (err) {
        console.error("Error removing video thumbnail:", err);
        setProcessingError("Failed to remove video thumbnail.");
      } finally {
        setIsRemovingThumbnail(false);
      }

      return false;
    }

    if (hasPendingVideoFrame) {
      return handleSaveGeneratedThumbnail();
    }

    if (!pendingThumbnailFile) return true;

    return uploadThumbnail(pendingThumbnailFile);
  };

  const handleRemoveThumbnail = () => {
    if (!thumbnailUrl && !pendingThumbnailFile) return;

    if (pendingThumbnailFile) {
      resetThumbnailSelection();
      return;
    }

    setPendingThumbnailFile(null);
    setPendingThumbnailUrl(null);
    setHasPendingVideoFrame(false);
    setThumbnailMarkedForRemoval(true);
    setIsThumbnailPickerOpen(false);
    if (thumbnailInputRef.current) {
      thumbnailInputRef.current.value = "";
    }
  };

  useEffect(() => {
    setCaptionsModified(captions !== oldCaptions);
  }, [captions, oldCaptions]);
  useEffect(() => {
    setSpeakersOrChairsModified(
      !checkContributorsEqual(oldSpeakers, speakers) || !checkContributorsEqual(oldChairs, chairs)
    );
  }, [speakers, chairs, oldSpeakers, oldChairs]);

  // Check if chapters have been modified
  useEffect(() => {
    const chaptersChanged =
      JSON.stringify(chapters) !== JSON.stringify(oldChapters);
    setChaptersModified(chaptersChanged);
  }, [chapters, oldChapters]);

  // Keep the original revision across polling retries so typed drafts win.
  const fetchCaptionsForLanguage = async (lang: string, revision = captionsRevision.current) => {
    if (!videoId) return;

    if (captionPollingRef.current) {
      clearTimeout(captionPollingRef.current);
      captionPollingRef.current = null;
    }

    setCaptionStatus("loading");


    try {
      const response = await fetch(
        `${env.apiBaseUrl || ""}/api/video-moderation/subtitle/${videoId}?lang=${lang}`,
        {
          method: "GET",
          headers: myHeaders.current,
        }
      );

      if (response.status === 200) {
        const vttText = await response.text();
        if (captionsRevision.current === revision) setCaptions(vttText);
        setOldCaptions(vttText);
        setCaptionStatus("available");
      } else if (response.status === 202) {
        setCaptionStatus("generating");
        captionPollingRef.current = setTimeout(
          () => fetchCaptionsForLanguage(lang, revision),
          5000
        );
      } else if (response.status === 404) {
        setCaptionStatus("not_available");
      } else {
        setCaptionStatus("not_available");
      }
    } catch (error) {
      console.error("Error fetching captions:", error);
      setCaptionStatus("not_available");
    }
  };

  // Auto-generate captions for a language
  const handleGenerateCaptions = async () => {
    if (!isUploaded || !videoId) return;

    const selectedLang = EUROPEAN_LANGUAGES.find(
      (l) => l.code === captionLanguage
    );
    if (!selectedLang) return;

    const revision = captionsRevision.current;
    setCaptionStatus("generating");

    try {
      const response = await fetch(
        `${env.apiBaseUrl || ""}/api/video-moderation/subtitle/autogenerate/${videoId}?lang=${captionLanguage}&name=${encodeURIComponent(selectedLang.name)}`,
        {
          method: "GET",
          headers: myHeaders.current,
        }
      );

      if (response.ok) {
        const vttText = await response.text();
        if (captionsRevision.current === revision) setCaptions(vttText);
        // Generation returns a draft; only a successful save updates oldCaptions.
        setCaptionStatus("available");
        setCaptionsModified(true);
      } else {
        setProcessingError("Failed to generate captions. Please try again.");
        setCaptionStatus("not_available");
      }
    } catch (error) {
      console.error("Error generating captions:", error);
      setProcessingError("Failed to generate captions. Please try again.");
      setCaptionStatus("not_available");
    }
  };

  // Save captions
  const handleSaveCaptions = async () => {
    if (!isUploaded || !videoId) return false;
    if (!captions.trim()) {
      setProcessingError(t("uploadEmptyCaptionsHint"));
      return false;
    }

    const selectedLang = EUROPEAN_LANGUAGES.find(
      (l) => l.code === captionLanguage
    ) || (captionLanguage === "auto" ? { name: t("autoGeneratedCaptions"), code: "auto" } : undefined);
    if (!selectedLang) return false;

    setIsSavingCaptions(true);
    try {
      const response = await fetch(
        `${env.apiBaseUrl || ""}/api/video-moderation/subtitle/replacev2/${videoId}?lang=${captionLanguage}&name=${selectedLang.name}`,
        {
          method: "POST",
          headers: myHeaders.current,
          body: JSON.stringify({ vtt: captions }),
        }
      );

      if (response.ok) {
        await refreshVideoPreview();
        setCaptionStatus("available");
        setOldCaptions(captions);
        setCaptionsModified(false);
        return true;
      } else if (response.status === 502) {
        setProcessingError(
          "Mux track is not ready yet. Please try again later."
        );
      } else if (response.status === 404) {
        setProcessingError("Video not found.");
      } else {
        setProcessingError("Failed to save captions.");
      }
    } catch (error) {
      console.error("Error saving captions:", error);
      setProcessingError("Failed to save captions.");
    } finally {
      setIsSavingCaptions(false);
    }
    return false;
  };

  // Delete captions
  const handleDeleteCaptions = async () => {
    if (!videoId) return;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete the ${EUROPEAN_LANGUAGES.find((l) => l.code === captionLanguage)?.name} captions?`
    );
    if (!confirmDelete) return;

    setIsDeletingCaptions(true);
    try {
      const response = await fetch(
        `${env.apiBaseUrl || ""}/api/video-moderation/subtitle/${videoId}?lang=${captionLanguage}`,
        {
          method: "DELETE",
          headers: myHeaders.current,
        }
      );

      if (response.ok) {
        await refreshVideoPreview();
        setCaptions("");
        setOldCaptions("");
        setCaptionStatus("not_available");
        setCaptionsModified(false);
      } else {
        setProcessingError("Failed to delete captions.");
      }
    } catch (error) {
      console.error("Error deleting captions:", error);
      setProcessingError("Failed to delete captions.");
    } finally {
      setIsDeletingCaptions(false);
    }
  };

  // Handle caption text change
  const handleCaptionsChange = (newValue: string) => {
    captionsRevision.current += 1;
    setCaptions(newValue);
    setCaptionsModified(newValue !== oldCaptions);
  };

  const checkContributorsEqual = (
    oldList: Contributor[],
    newList: Contributor[]
  ): boolean => {
    if (oldList.length !== newList.length) return false;
    const oldIds = oldList.map((c) => c.id).sort();
    const newIds = newList.map((c) => c.id).sort();
    return JSON.stringify(oldIds) === JSON.stringify(newIds);
  };

  const updateContributorsModified = (
    newSpeakers: Contributor[],
    newChairs: Contributor[]
  ) => {
    const speakersEqual = checkContributorsEqual(oldSpeakers, newSpeakers);
    const chairsEqual = checkContributorsEqual(oldChairs, newChairs);
    setSpeakersOrChairsModified(!speakersEqual || !chairsEqual);
  };

  const handleContributorAdd = (params: {
    type?: boolean;
    new: Contributor;
  }) => {
    if (!params.type) {
      const newSpeakers = [...speakers, params.new];
      setSpeakers(newSpeakers);
      updateContributorsModified(newSpeakers, chairs);
    } else {
      const newChairs = [...chairs, params.new];
      setChairs(newChairs);
      updateContributorsModified(speakers, newChairs);
    }
  };

  const handleContributorRemove = (params: { type?: boolean; id: string }) => {
    if (!params.type) {
      const filtered = speakers.filter((c) => c.id !== params.id);
      setSpeakers(filtered);
      updateContributorsModified(filtered, chairs);
    } else {
      const filtered = chairs.filter((c) => c.id !== params.id);
      setChairs(filtered);
      updateContributorsModified(speakers, filtered);
    }
  };

  // Save speakers and chairs
  const handleSaveContributors = async () => {
    if (!videoId) return;

    setIsSavingContributors(true);
    try {
      const response = await fetchFn<{ success: boolean }>({
        route: `api/video-moderation/video-details/${videoId}`,
        options: {
          method: "PATCH",
          headers: myHeaders.current,
          body: JSON.stringify({
            speakers: speakers.map((s) => s.id),
            chairs: chairs.map((c) => c.id),
          }),
        },
      });

      if (response?.success) {
        await refreshVideoPreview();
        setOldSpeakers([...speakers]);
        setOldChairs([...chairs]);
        setSpeakersOrChairsModified(false);
      } else {
        setProcessingError("Failed to save speakers and chairs.");
      }
    } catch (error) {
      console.error("Error saving contributors:", error);
      setProcessingError("Failed to save speakers and chairs.");
    } finally {
      setIsSavingContributors(false);
    }
  };

  // Save chapters
  const handleSaveChapters = async () => {
    if (!videoId) return;

    setIsSavingChapters(true);
    try {
      const chaptersPayload = chapters.map((ch) => ({
        title: ch.title,
        startTime: parseTimestampToSeconds(ch.timestamp),
      }));

      const response = await fetchFn<{ success: boolean }>({
        route: `api/video-moderation/video-details/${videoId}`,
        options: {
          method: "PATCH",
          headers: myHeaders.current,
          body: JSON.stringify({ chapters: chaptersPayload }),
        },
      });

      if (response?.success) {
        await refreshVideoPreview();
        setOldChapters([...chapters]);
        setChaptersModified(false);
      } else {
        setProcessingError("Failed to save chapters.");
      }
    } catch (error) {
      console.error("Error saving chapters:", error);
      setProcessingError("Failed to save chapters.");
    } finally {
      setIsSavingChapters(false);
    }
  };

  // Preserve unsaved captions before switching language.
  const handleCaptionLanguageChange = (newLang: string) => {
    if (captionsModified) {
      setProcessingError(t("uploadSaveCaptionsFirst"));
      return;
    }
    captionsRevision.current = 0;
    setCaptions("");
    setOldCaptions("");
    setCaptionLanguage(newLang);
    if (currentStep === 3 && isUploaded && videoId) {
      fetchCaptionsForLanguage(newLang);
    }
  };

  const uploadFileToMux = async (uploadUrl: string, file: File) => {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("PUT", uploadUrl);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.onabort = () => reject(new Error("Upload cancelled"));
      xhr.send(file);
    });
  };

  const pollForCaptions = async (vid: string, lang: string) => {
    setProcessingPhase("processing_asset");

    const poll = async () => {
      if (!mountedRef.current) return;
      try {
        const response = await fetch(
        `${env.apiBaseUrl || ""}/api/video-moderation/subtitle/${vid}?lang=${lang}`,
          {
            method: "GET",
            headers: myHeaders.current,
          }
        );

        if (!mountedRef.current) return;
        if (response.status === 202) {
          const data = await response.json();
          if (data.code === "ASSET_PROCESSING") {
            setProcessingPhase("processing_asset");
          } else if (data.code === "CAPTIONS_PROCESSING") {
            setProcessingPhase("generating_captions");
          }
          pollingRef.current = setTimeout(poll, 5000);
        } else if (response.status === 200) {
          setProcessingError(null);
          const vttText = await response.text();
          const detectedLanguage = response.headers.get("X-Mux-Lang") || lang;
          if (lang === "auto") setCaptionLanguage(detectedLanguage);
          if (captionsRevision.current === 0) setCaptions(vttText);
          setOldCaptions(vttText);
          setCaptionStatus("available");

          await generateChapters(vid, response.headers.get("X-Mux-Lang") || lang);
        } else {
          const error = await response.json().catch(() => ({}));
          if (error.code === "NO_CAPTIONS" || error.code === "CAPTIONS_ERRORED") {
            // These responses are only returned after the asset is ready.
            setProcessingError(t("uploadCaptionsUnavailable"));
            setCaptionStatus("not_available");
            await saveInitialData(vid, []);
          } else {
            setProcessingError(t("uploadStatusRetrying"));
            pollingRef.current = setTimeout(poll, 5000);
          }
        }
      } catch (error) {
        console.error("Error polling captions:", error);
        pollingRef.current = setTimeout(poll, 5000);
      }
    };

    poll();
  };

  // Save initial data (speakers, chairs, chapters) after chapter generation
  const saveInitialData = async (vid: string, generatedChapters: Chapter[]) => {
    if (!mountedRef.current) return;
    setProcessingPhase("saving_initial_data");

    const snapshot = draftRef.current;
    const savedChapters = generatedChapters;
    const saveGeneratedChapters = chaptersRevision.current === 0;
    try {
      const chaptersPayload = savedChapters.map((ch) => ({
        title: ch.title,
        startTime: parseTimestampToSeconds(ch.timestamp),
      }));

      const response = await fetchFn<{ success: boolean }>({
        route: `api/video-moderation/video-details/${vid}`,
        options: {
          method: "PATCH",
          headers: myHeaders.current,
          body: JSON.stringify({
            speakers: snapshot.speakers.map((s) => s.id),
            chairs: snapshot.chairs.map((c) => c.id),
            ...(saveGeneratedChapters ? { chapters: chaptersPayload } : {}),
          }),
        },
      });

      if (response?.success) {
        // Update old values to reflect saved state
        setOldSpeakers([...snapshot.speakers]);
        setOldChairs([...snapshot.chairs]);
        if (saveGeneratedChapters) setOldChapters([...savedChapters]);


      } else {
        setProcessingError(t("uploadInitialSaveFailed"));
      }
    } catch (error) {
      console.error("Error saving initial data:", error);
      setProcessingError(t("uploadInitialSaveFailed"));
    }

    setProcessingPhase("complete");

  };

  const generateChapters = async (vid: string, lang: string) => {
    if (!mountedRef.current) return;
    setProcessingPhase("generating_chapters");

    let generatedChapters: Chapter[] = [];

    try {
      const response = (await fetchFn({
        route: "api/videos/generate-chapters",
        options: {
          method: "POST",
          headers: myHeaders.current,
          body: JSON.stringify({
            videoId: vid,
            languageCode: lang,
          }),
        },
      })) as GenerateChaptersResponse | null;

      if (response?.chapters) {
        generatedChapters = response.chapters.map((ch) => ({
          timestamp: formatSecondsToTimestamp(ch.startTime),
          title: ch.title,
        }));
        if (chaptersRevision.current === 0) setChapters(generatedChapters);
      }
    } catch (error) {
      console.error("Error generating chapters:", error);
    }

    // Save speakers, chairs, and chapters
    await saveInitialData(vid, generatedChapters);
  };

  const handleRegenerateChapters = async () => {
    if (!isUploaded || !videoId) return;
    const revision = chaptersRevision.current;

    setProcessingPhase("generating_chapters");
    try {
      const response = (await fetchFn({
        route: "api/videos/generate-chapters",
        options: {
          method: "POST",
          headers: myHeaders.current,
          body: JSON.stringify({
            videoId: videoId,
            languageCode: captionLanguage,
          }),
        },
      })) as GenerateChaptersResponse | null;

      if (response?.chapters) {
        const formattedChapters: Chapter[] = response.chapters.map((ch) => ({
          timestamp: formatSecondsToTimestamp(ch.startTime),
          title: ch.title,
        }));
        if (chaptersRevision.current === revision) setChapters(formattedChapters);
      }
      setProcessingPhase("complete");
    } catch (error) {
      console.error("Error generating chapters:", error);
      setProcessingPhase("complete");
    }
  };

  const handleGenerateWithAI = async (
    type: "title" | "description" | "tags"
  ) => {
    if (!isUploaded || !videoId) return;

    const setLoading =
      type === "title"
        ? setIsGeneratingTitle
        : type === "description"
          ? setIsGeneratingDescription
          : setIsGeneratingTags;

    setLoading(true);
    try {
      const response = await fetch(
        `${env.apiBaseUrl || ""}/api/video-moderation/details/autogenerate/${videoId}?type=${type}`,
        {
          method: "GET",
          headers: myHeaders.current,
        }
      );

      if (!response.ok) {
        setProcessingError(
          `Failed to generate ${type}. Make sure the video has English subtitles added.`
        );
        return;
      }

      const data = await response.json();

      if (type === "title") {
        setTitle(data.result as string);
      } else if (type === "description") {
        setDescription(data.result as string);
      } else {
        setTags(Array.from(new Set(data.result as string[])));
      }
    } catch (error) {
      console.error(`Error generating ${type}:`, error);
      setProcessingError(`Failed to generate ${type}. Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  const initiateUpload = async () => {
    if (!videoFile || !title.trim() || isProcessing) return;

    setProcessingPhase("initializing");
    setProcessingError(null);
    setUploadProgress(0);

    const selectedLang = MUX_SPOKEN_LANGUAGES.find((l) => l.code === spokenLanguage);
    if (spokenLanguage !== "auto" && !selectedLang) { setProcessingPhase("idle"); return; }



    try {
      const initiateResponse = (await fetchFn({
        route: "api/videos/upload/initiate",
        options: {
          method: "POST",
          headers: myHeaders.current,
          body: JSON.stringify({
            title: title.trim(),
            language_code: spokenLanguage,
            ...(selectedLang ? { language_name: selectedLang.name } : {}),
            playback_policy: playbackPolicy,
          }),
        },
      })) as UploadInitiateResponse | null;

      if (!initiateResponse?.upload?.upload_url) {
        throw new Error("Failed to initiate upload");
      }

      const { video_id, upload } = initiateResponse;
      setVideoId(video_id);
      setCurrentStep(2);
      document.scrollingElement?.scrollTo({ top: 0, behavior: "smooth" });

      setProcessingPhase("uploading");
      await uploadFileToMux(upload.upload_url, videoFile);

      pollForCaptions(video_id, spokenLanguage);
    } catch (error) {
      if (!mountedRef.current) return;
      console.error("Upload error:", error);
      setCurrentStep(1);
      setVideoId(null);
      setProcessingPhase("idle");
      setProcessingError("Failed to upload video. Please try again.");
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isUploaded && !isProcessing) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (isUploaded || isProcessing) return;

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("video/")) {
      setVideoFile(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isUploaded || isProcessing) return;

    const file = e.target.files?.[0];
    if (file && file.type.startsWith("video/")) {
      setVideoFile(file);
    }
  };

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const removeVideo = () => {
    if (isUploaded || isProcessing) return;

    setVideoFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const addChapter = () => {
    chaptersRevision.current += 1;
    setChapters([...chapters, { timestamp: "00:00:00", title: "" }]);
  };

  const updateChapter = (
    index: number,
    field: keyof Chapter,
    value: string
  ) => {
    chaptersRevision.current += 1;
    setChapters(chapters.map((chapter, chapterIndex) =>
      chapterIndex === index ? { ...chapter, [field]: value } : chapter
    ));
  };

  const removeChapter = (index: number) => {
    chaptersRevision.current += 1;
    setChapters(chapters.filter((_, i) => i !== index));
  };

  const handleNext = () => {
    if (currentStep === 1) {
      if (videoId) {
        setCurrentStep(2);
        document.scrollingElement?.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        initiateUpload();
      }
    } else if (currentStep < 3) {
      setCurrentStep(prev => prev + 1);
      document.scrollingElement?.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
      document.scrollingElement?.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return !!videoFile && title.trim().length > 0;
      case 2:
        return true;
      case 3:
        return title.trim().length > 0;
      default:
        return false;
    }
  };

  const handleSubmit = async () => {
    if (!isUploaded || !videoId || isSavingDetails) return;

    setIsSavingDetails(true);
    try {
      if (captionsModified && !(await handleSaveCaptions())) return;
      if (thumbnailModified && !(await handleSaveThumbnail())) return;
      const response = await fetchFn<{ success: boolean }>({
        route: `api/video-moderation/video-details/${videoId}`,
        options: {
          method: "PATCH",
          headers: myHeaders.current,
          body: JSON.stringify({
            title,
            description,
            tags,
            visibility,
            speakers: speakers.map((person) => person.id),
            chairs: chairs.map((person) => person.id),
            chapters: chapters.map((chapter) => ({ title: chapter.title, startTime: parseTimestampToSeconds(chapter.timestamp) })),
          }),
        },
      });

      if (response?.success) {
        await refreshVideoPreview();
        navigate("/my-videos");
        onFinish?.();
      } else {
        setProcessingError("Failed to save video.");
      }
    } catch (error) {
      console.error("Error saving video:", error);
      setProcessingError("Failed to save video.");
    } finally {
      setIsSavingDetails(false);
    }
  };

  const steps = [
    { number: 1, label: t("uploadVideoAction") },
    { number: 2, label: t("videoDetails") },
    { number: 3, label: t("uploadCaptionsChapters") },
  ];

  // The session host survives route changes; cleanup only on session disposal.
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      xhrRef.current?.abort();
      if (pollingRef.current) clearTimeout(pollingRef.current);
      if (captionPollingRef.current) clearTimeout(captionPollingRef.current);
    };
  }, []);

  // Remove theater button
  useEffect(() => {
    if (currentStep > 1 && videoData)
      window.dispatchEvent(
        new CustomEvent("theater-disable", { bubbles: true, composed: true })
      );
  }, [currentStep, videoData]);

  return (
    <>
      <main className={`uploadMain ${statusStyles.page}`}>
        <Sidebar />
        <div
          className={`uploadSide ${currentStep > 1 ? "max-w-325 w-full" : ""}`}
        >
          <h1>{t("videoUploadTitle")}</h1>
          <p className="mt-3 links">
            By submitting videos to this platform, you agree to our{" "}
            <Link to="/termsOfUse">{t("termsOfUse")}</Link> and{" "}
            <Link to="/privacyPolicy">{t("privacyPolicy")}</Link>.
          </p>

          {/* Step Indicator */}
          <div className="stepIndicator">
            {steps.map((step, index) => (
              <div key={step.number} className="stepItem">
                <div
                  className={`stepCircle ${
                    currentStep === step.number
                      ? "active"
                      : currentStep > step.number
                        ? "completed"
                        : ""
                  }`}
                >
                  {currentStep > step.number ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    step.number
                  )}
                </div>
                <span
                  className={`stepLabel ${currentStep === step.number ? "active" : ""}`}
                >
                  {step.label}
                </span>
                {index < steps.length - 1 && <div className="stepLine" />}
              </div>
            ))}
          </div>

          {(isProcessing || isUploaded) && (
            <div className={statusStyles.status} role="status" aria-live="polite">
              {isProcessing && <div className="uploadSpinner small" />}
              <div className={statusStyles.body}>
                <strong>{phaseLabel}</strong>
                <p>{t(isUploaded ? "uploadReadyHint" : "uploadBackgroundHint")}</p>
                {processingPhase === "uploading" && (
                  <div className={statusStyles.progress} role="progressbar" aria-label={t("uploadPhaseUploading")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}>
                    <span style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
              </div>
            </div>
          )}
          {currentStep > 1 && !isUploaded && <p className={statusStyles.hint}>{t("uploadAIReadyHint")}</p>}

          {/* Error Message */}
          {processingError && (
            <div className="errorBanner">
              <p>{processingError}</p>
              <button
                type="button"
                onClick={() => setProcessingError(null)}
                className="dismissErrorBtn"
              >
                ×
              </button>
            </div>
          )}

          {/* Step 1: Upload Video */}
          {currentStep === 1 && (
            <div className="stepContent">
              {isUploaded && (
                <div className="uploadedBanner">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span>
                    Video uploaded successfully. These settings cannot be
                    changed.
                  </span>
                </div>
              )}

              <div
                className={`uploadZone ${isDragging ? "dragging" : ""} ${videoFile ? "hasFile" : ""} ${isUploaded || isProcessing ? "disabled" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() =>
                  !videoFile && !isUploaded && fileInputRef.current?.click()
                }
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="video/*"
                  onChange={handleFileSelect}
                  hidden
                  disabled={isUploaded || isProcessing}
                />
                {videoFile ? (
                  <div className="fileInfo">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                    <p className="fileName">{videoFile.name}</p>
                    <p className="fileSize">
                      {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                    {!isUploaded && !isProcessing && (
                      <button
                        type="button"
                        className="removeFileBtn"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeVideo();
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="uploadPrompt">
                    {UploadSVG}
                    <p>{t("dragDropVideoFile")}</p>
                    <span>or</span>
                    <button type="button" className="selectFileBtn">
                      Select file
                    </button>
                  </div>
                )}
              </div>
              <div className="formGroup mt-7.5">
                <label htmlFor="muxTitle">{t("title")}</label>
                <input
                  type="text"
                  id="muxTitle"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("muxTitlePlaceholder")}
                  maxLength={100}
                  disabled={isUploaded || isProcessing}
                  className={isUploaded ? "disabled" : ""}
                />
                <span className="charCount">{title.length}/100</span>
              </div>
              <div className="formGroup my-7.5">
                <ContributorSearch
                  label="Speakers"
                  selectedContributors={speakers}
                  onAdd={(contributor) =>
                    handleContributorAdd({ new: contributor })
                  }
                  onRemove={(id) => handleContributorRemove({ id: id })}
                  placeholder={t("searchSpeakersPlaceholder")}
                />

                <ContributorSearch
                  label="Chairs"
                  selectedContributors={chairs}
                  onAdd={(contributor) =>
                    handleContributorAdd({ type: true, new: contributor })
                  }
                  onRemove={(id) =>
                    handleContributorRemove({ type: true, id: id })
                  }
                  placeholder={t("searchChairsPlaceholder")}
                />
              </div>
              <div className="formGroup mt-2">
                <label htmlFor="captionLanguage">{t("spokenLanguage")}</label>
                <div className="captionsInputRow">
                  <CustomSelect
                    id="captionLanguage"
                    value={spokenLanguage}
                    onChange={(value) => { setSpokenLanguage(value); setCaptionLanguage(value); }}
                    options={[{ value: "auto", label: t("spokenLanguageAuto") }, ...MUX_SPOKEN_LANGUAGES.map((lang) => ({
                      value: lang.code,
                      label: `${lang.name} - ${lang.code}`,
                    }))]}
                    ariaLabel={t("spokenLanguage")}
                    triggerClassName={`languageSelect ${isUploaded || isProcessing ? "disabled" : ""}`}
                    disabled={isUploaded || isProcessing}
                  />
                </div>
                <p className="formHint">{t("spokenLanguageAutoHelp")}</p>
              </div>
              <div className="formGroup mt-7.5">
                <label htmlFor="uploadPlaybackPolicy">{t("playbackProtection")}</label>
                <CustomSelect id="uploadPlaybackPolicy" value={playbackPolicy}
                  onChange={(value) => setPlaybackPolicy(value as "public" | "signed")}
                  options={[{ value: "signed", label: t("playbackSigned") }, { value: "public", label: t("playbackPublic") }]}
                  ariaLabel={t("playbackProtection")} triggerClassName="visibilitySelect"
                  disabled={isUploaded || isProcessing} />
                <p className="formHint">{t(playbackPolicy === "signed" ? "playbackSignedHelp" : "playbackPublicHelp")}</p>
              </div>
            </div>
          )}

          {/* Step 3: Captions & Chapters */}
          {currentStep === 3 && (
            <div className="stepContentWithPreview">
              <aside ref={previewAsideRef} className="stepContentSidebar">
                <div ref={previewStickyRef} style={previewStickyStyle}>
                  <VideoEditorPreview
                    revision={previewRevision}
                    isVideoLoading={isVideoLoading}
                    videoData={videoData}
                    title={title}
                    chapters={chapters}
                  />
                </div>
              </aside>
              <div className="stepContentMain">
                <div className="videoDetailsForm">
                  <div className="formGroup editSection">
                    <div className="captionToolbar">
                      <h2 className="captionToolbarTitle">{t("captions")}</h2>
                      <div className="captionToolbarControls">
                        <div className="captionsInputRow">
                          <CustomSelect
                            id="captionLanguageStep2"
                            value={captionLanguage}
                            onChange={handleCaptionLanguageChange}
                            options={[...(captionLanguage === "auto" ? [{ value: "auto", label: t("autoGeneratedCaptions") }] : []), ...EUROPEAN_LANGUAGES.map((lang) => ({
                              value: lang.code,
                              label: `${lang.name} - ${lang.code}`,
                            }))]}
                            ariaLabel={t("spokenLanguage")}
                            triggerClassName="languageSelect"
                            disabled={
                              !isUploaded || captionStatus === "loading" ||
                              captionStatus === "generating" ||
                              isSavingCaptions ||
                              isDeletingCaptions
                            }
                          />
                        </div>
                        {(captionStatus === "not_available" || !isUploaded) && (
                          <button
                            type="button"
                            onClick={handleGenerateCaptions}
                            disabled={!isUploaded || captionLanguage === "auto" || captionStatus === "generating"}
                            title={!isUploaded ? t("uploadAIReadyHint") : undefined}
                            className="generateAIBtn"
                          >
                            {AISVG}&nbsp;Generate with AI
                          </button>
                        )}
                      </div>
                    </div>

                    <CaptionStatusMessage
                      status={captionStatus}
                      language={EUROPEAN_LANGUAGES.find((language) => language.code === captionLanguage)?.name || t("autoGeneratedCaptions")}
                    />

                    <>
                        <textarea
                          id="videoCaptions"
                          aria-label={t("captions")}
                          value={captions}
                          onChange={(e) => handleCaptionsChange(e.target.value)}
                          placeholder={t("captionsPlaceholder")}
                          rows={8}
                        />
                        <div className="captionsActions">
                          <p className="formHint">
                            Supports VTT format
                            {captionsModified && (
                              <span className="unsavedIndicator">
                                {" "}
                                • Unsaved changes
                              </span>
                            )}
                          </p>
                          <div className="captionsButtonGroup">
                            <button
                              type="button"
                              onClick={handleSaveCaptions}
                              disabled={!isUploaded || !captions.trim() || !captionsModified || isSavingCaptions || isDeletingCaptions}
                              className="saveCaptionsBtn"
                            >
                              {isSavingCaptions ? (
                                <>
                                  <div className="uploadSpinner tiny" />
                                  Saving...
                                </>
                              ) : (
                                "Save Captions"
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={handleDeleteCaptions}
                              disabled={!isUploaded || captionStatus !== "available" || isDeletingCaptions || isSavingCaptions}
                              className="deleteCaptionsBtn"
                            >
                              {isDeletingCaptions ? (
                                <>
                                  <div className="uploadSpinner tiny" />
                                  Deleting...
                                </>
                              ) : (
                                "Delete Captions"
                              )}
                            </button>
                          </div>
                        </div>
                    </>
                  </div>

                  <div className="formGroup editSection mt-10">
                    <ContributorSearch
                      label="Speakers"
                      selectedContributors={speakers}
                      onAdd={(contributor) =>
                        handleContributorAdd({ new: contributor })
                      }
                      onRemove={(id) => handleContributorRemove({ id: id })}
                      placeholder={t("searchSpeakersPlaceholder")}
                    />

                    <ContributorSearch
                      label="Chairs"
                      selectedContributors={chairs}
                      onAdd={(contributor) =>
                        handleContributorAdd({ type: true, new: contributor })
                      }
                      onRemove={(id) =>
                        handleContributorRemove({ type: true, id: id })
                      }
                      placeholder={t("searchChairsPlaceholder")}
                    />

                    <div className="captionsActions">
                      <p className="formHint">
                        {speakersOrChairsModified && (
                          <span className="unsavedIndicator">
                            • Unsaved changes
                          </span>
                        )}
                      </p>

                      <div className="captionsButtonGroup">
                        <button
                          type="button"
                          onClick={handleSaveContributors}
                          disabled={
                            !isUploaded || !speakersOrChairsModified || isSavingContributors
                          }
                          className="saveCaptionsBtn"
                        >
                          {isSavingContributors ? (
                            <>
                              <div className="uploadSpinner tiny" />
                              Saving...
                            </>
                          ) : (
                            "Save Speakers & Chairs"
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="formGroup editSection mt-10">
                    <label>
                      Chapters
                      <button
                        type="button"
                        onClick={handleRegenerateChapters}
                        disabled={
                          !isUploaded ||
                          captionStatus !== "available"
                        }
                      >
                        {AISVG}&nbsp;Generate with AI
                      </button>
                    </label>
                    <div className="chaptersContainer">
                      {chapters.length === 0 ? (
                        <p className="noChapters">
                          {captionStatus !== "available"
                            ? "Captions are required to generate chapters."
                            : "No chapters generated. Click 'Generate with AI' to create chapters."}
                        </p>
                      ) : (
                        chapters.map((chapter, index) => (
                          <div key={index} className="chapterRow">
                            <input
                              type="text"
                              className="chapterTimestamp"
                              value={chapter.timestamp}
                              onChange={(e) =>
                                updateChapter(index, "timestamp", e.target.value)
                              }
                              placeholder="00:00:00"
                            />
                            <input
                              type="text"
                              className="chapterTitle"
                              value={chapter.title}
                              onChange={(e) =>
                                updateChapter(index, "title", e.target.value)
                              }
                              placeholder={t("chapterTitlePlaceholder")}
                            />
                            <button
                              type="button"
                              className="removeChapterBtn"
                              onClick={() => removeChapter(index)}
                            >
                              ×
                            </button>
                          </div>
                        ))
                      )}
                      <button
                        type="button"
                        className="addChapterBtn"
                        onClick={addChapter}
                      >
                        + Add Chapter
                      </button>
                    </div>
                    <div className="captionsActions">
                      <p className="formHint">
                        {chaptersModified && (
                          <span className="unsavedIndicator">
                            • Unsaved changes
                          </span>
                        )}
                      </p>
                      <div className="captionsButtonGroup">
                        <button
                          type="button"
                          onClick={handleSaveChapters}
                          disabled={!isUploaded || !chaptersModified || isSavingChapters}
                          className="saveCaptionsBtn"
                        >
                          {isSavingChapters ? (
                            <>
                              <div className="uploadSpinner tiny" />
                              Saving...
                            </>
                          ) : (
                            "Save Chapters"
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Video Details */}
          {currentStep === 2 && (
            <div className="stepContentWithPreview">
              <aside ref={previewAsideRef} className="stepContentSidebar">
                <div ref={previewStickyRef} style={previewStickyStyle}>
                  <VideoEditorPreview
                    revision={previewRevision}
                    isVideoLoading={isVideoLoading}
                    videoData={videoData}
                    title={title}
                    chapters={chapters}
                  />
                </div>
              </aside>
              <div className="stepContentMain">
                <div className="videoDetailsForm">
                  <div className="formGroup editSection">
                    <h2 className="editSectionTitle">{t("thumbnail")}</h2>

                    <input
                      type="file"
                      ref={thumbnailInputRef}
                      accept="image/*"
                      onChange={handleThumbnailFileSelect}
                      hidden
                    />
                    {!isThumbnailPickerOpen && (
                      <div className="thumbnailSettingsPreview">
                        {displayedThumbnailUrl ? (
                          <ThumbnailImage src={displayedThumbnailUrl} alt={t("thumbnail")} className="thumbnailPickerImage" />
                        ) : (
                          <div className="thumbnailSettingsEmpty">
                            {UploadSVG}
                            <span>{t("selectThumbnailImage")}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="thumbnailSourceActions">
                      <div className="thumbnailSourceHeading">
                        <button
                          type="button"
                          className="thumbnailPickerToggle"
                          onClick={() => thumbnailInputRef.current?.click()}
                          disabled={isUploadingThumbnail || isRemovingThumbnail}
                        >
                          {UploadSVG}
                          Select file
                        </button>
                        <button
                          type="button"
                          className={`thumbnailPickerToggle ${isThumbnailPickerOpen ? "active" : ""}`}
                          onClick={handleToggleThumbnailPicker}
                          disabled={!canChooseVideoFrame || isUploadingThumbnail || isRemovingThumbnail}
                        >
                          {isThumbnailPickerOpen ? "Back to image" : "Choose from video"}
                        </button>
                      </div>
                      <p className="formHint thumbnailPickerHint">
                        {pendingThumbnailFile
                          ? `${pendingThumbnailFile.name} · ${(pendingThumbnailFile.size / (1024 * 1024)).toFixed(2)} MB`
                          : isThumbnailPickerOpen
                          ? "Choose a frame from the timeline, then save your thumbnail."
                          : t("imageFormatsHint")}
                      </p>
                    </div>

                    {isThumbnailPickerOpen && canChooseVideoFrame ? (
                      <div className="thumbnailPickerCard">
                        <div className="thumbnailPickerPreview">
                          {hasPendingVideoFrame && videoId ? (
                            <ThumbnailFramePreview videoId={videoId} time={selectedThumbnailTime} />
                          ) : (
                            <div className="thumbnailPickerPreviewPlaceholder">
                              <div className="uploadSpinner tiny" />
                              <span>{t("loadingVideoPreview")}</span>
                            </div>
                          )}
                        </div>

                        <div className="thumbnailPickerControls">
                          <div className="thumbnailPickerTimeRow">
                            <span>{t("thumbnail")}</span>
                            <strong>{formatThumbnailPickerTime(selectedThumbnailTime)}</strong>
                          </div>
                          <div className="thumbnailPickerTimeInputRow">
                            <label htmlFor="uploadThumbnailFrameTime">{t("jumpToTime")}</label>
                            <input
                              id="uploadThumbnailFrameTime"
                              type="text"
                              value={thumbnailTimeInput}
                              onChange={handleThumbnailTimeInputChange}
                              onBlur={commitThumbnailTimeInput}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitThumbnailTimeInput();
                                }
                              }}
                              placeholder="00:00 or 00:00:00"
                              className="thumbnailPickerTimeInput"
                            />
                          </div>
                          <div className="thumbnailPickerSliderWrap">
                            <input
                              type="range"
                              min={0}
                              max={maxThumbnailTime}
                              step={0.1}
                              value={Math.min(selectedThumbnailTime, maxThumbnailTime)}
                              onChange={handleThumbnailTimeChange}
                              className="thumbnailPickerSlider"
                            />
                          </div>
                          <div className="thumbnailPickerRangeLabels">
                            <span>00:00</span>
                            <span>{formatThumbnailPickerTime(videoDuration)}</span>
                          </div>
                        </div>
                      </div>
                    ) : null}

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
                              {thumbnailMarkedForRemoval
                                ? "Saving..."
                                : hasPendingVideoFrame
                                ? "Setting..."
                                : "Uploading..."}
                            </>
                          ) : (
                            hasPendingVideoFrame
                              ? "Set Frame as Thumbnail"
                              : "Save Thumbnail"
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
                        ) : displayedThumbnailUrl ? (
                          "Upload an image or choose a video frame to change your thumbnail."
                        ) : (
                          "No thumbnail selected yet."
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="formGroup editSection">
                    <label htmlFor="videoTitle">
                      Title
                      <button
                        type="button"
                        onClick={() => handleGenerateWithAI("title")}
                        disabled={isGeneratingTitle || !isUploaded}
                        title={!isUploaded ? t("uploadAIReadyHint") : undefined}
                      >
                        {isGeneratingTitle ? (
                          <><div className="uploadSpinner tiny" />&nbsp;Generating...</>
                        ) : (
                          <>{AISVG}&nbsp;Generate with AI</>
                        )}
                      </button>
                    </label>
                    <input
                      type="text"
                      id="videoTitle"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={t("enterVideoTitle")}
                      maxLength={100}
                    />
                    <span className="charCount">{title.length}/100</span>
                  </div>

                  <div className="formGroup editSection">
                    <label htmlFor="videoDescription">
                      Description
                      <button
                        type="button"
                        onClick={() => handleGenerateWithAI("description")}
                        disabled={isGeneratingDescription || !isUploaded}
                        title={!isUploaded ? t("uploadAIReadyHint") : undefined}
                      >
                        {isGeneratingDescription ? (
                          <><div className="uploadSpinner tiny" />&nbsp;Generating...</>
                        ) : (
                          <>{AISVG}&nbsp;Generate with AI</>
                        )}
                      </button>
                    </label>
                    <textarea
                      id="videoDescription"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t("enterVideoDescription")}
                      rows={5}
                      maxLength={5000}
                    />
                    <span className="charCount">{description.length}/5000</span>
                  </div>

                  <div className="formGroup editSection">
                    <label htmlFor="videoTags">
                      Tags
                      <button
                        type="button"
                        onClick={() => handleGenerateWithAI("tags")}
                        disabled={isGeneratingTags || !isUploaded}
                        title={!isUploaded ? t("uploadAIReadyHint") : undefined}
                      >
                        {isGeneratingTags ? (
                          <><div className="uploadSpinner tiny" />&nbsp;Generating...</>
                        ) : (
                          <>{AISVG}&nbsp;Generate with AI</>
                        )}
                      </button>
                    </label>
                    <div className="tagsContainer">
                      {tags.map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                          <button
                            type="button"
                            className="removeTagBtn"
                            onClick={() => removeTag(tag)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        id="videoTags"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={handleTagKeyDown}
                        placeholder={
                          tags.length === 0 ? "Press Enter to add tags" : ""
                        }
                      />
                    </div>
                  </div>

                  <div className="formGroup editSection">
                    <label htmlFor="videoVisibility">{t("visibility")}</label>
                    <CustomSelect
                      id="videoVisibility"
                      value={visibility}
                      onChange={(value) => setVisibility(value as "public" | "private")}
                      options={[
                        { value: "public", label: t("adminPublic") },
                        { value: "private", label: t("adminPrivate") },
                      ]}
                      ariaLabel={t("visibility")}
                      triggerClassName="visibilitySelect"
                    />
                    <p className="formHint">
                      {visibility === "public"
                        ? "Anyone can view this video."
                        : "Only you and people you share the link with can view this video."}
                    </p>
                  </div>

                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <section ref={previewBoundaryRef} className="bottomBtns">
            {currentStep === 1 ? (
              <button
                type="button"
                className="cancelBtn"
                onClick={() => navigate("/my-videos")}
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="cancelBtn"
                onClick={handleBack}
              >
                Back
              </button>
            )}
            {currentStep < 3 ? (
              <button
                type="button"
                className="uploadBtn"
                disabled={!canProceed() || (currentStep === 1 && processingPhase === "initializing")}
                onClick={handleNext}
              >
                {currentStep === 1 && processingPhase === "initializing" ? t("uploadPhase_initializing") : "Next"}
              </button>
            ) : (
              <button
                type="submit"
                className="uploadBtn"
                disabled={!isUploaded || !canProceed() || isSavingDetails || isSavingCaptions || isSavingChapters || isSavingContributors || isUploadingThumbnail || isRemovingThumbnail || isGeneratingTitle || isGeneratingDescription || isGeneratingTags || captionStatus === "generating"}
                onClick={handleSubmit}
              >
                {isSavingDetails ? "Saving..." : "Save"}
              </button>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

export default UploadPage;
