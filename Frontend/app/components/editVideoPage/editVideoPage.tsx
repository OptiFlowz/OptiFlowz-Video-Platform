import { VideoEditorPreview, useVideoPreviewRefresh } from "../shared/videoEditorPreview";
import { ThumbnailImage } from "../shared/thumbnailImage";
import { CaptionStatusMessage } from "../shared/captionStatusMessage";
import { getVideoThumbnail, type VideoMedia } from "../shared/videoMedia";
import { ThumbnailFramePreview } from "../shared/thumbnailFramePreview";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  useState,
  useRef,
  useLayoutEffect,
  type KeyboardEvent,
  useEffect,
  useMemo,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { AISVG, UploadSVG } from "~/constants";
import { env } from "~/env";
import ContributorSearch from "~/components/uploadPage/contributorSearch";
import { fetchFn } from "~/API";
import { getToken } from "~/functions";
import { EUROPEAN_LANGUAGES } from "~/constants";
import Sidebar from "../myVideosPage/sidebar/sidebar";
import { useConstrainedSticky } from "~/components/shared/useConstrainedSticky";
import { useI18n } from "~/i18n";
import statusStyles from "../uploadPage/uploadStatus.module.css";
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
  chapters: { startTime: number; title: string }[];
  people: { id: string; name: string; image_url?: string; type: string }[];
  visibility: "public" | "private";
}

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

function EditVideoPage() {
  const { t, locale } = useI18n();
  const languageNames = useMemo(() => new Intl.DisplayNames([locale === "sr" ? "sr-Latn" : locale], { type: "language" }), [locale]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const videoId = searchParams.get("video");
  const { previewRevision, refreshVideoPreview } = useVideoPreviewRefresh(videoId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [speakers, setSpeakers] = useState<Contributor[]>([]);
  const [oldSpeakers, setOldSpeakers] = useState<Contributor[]>([]);
  const [chairs, setChairs] = useState<Contributor[]>([]);
  const [oldChairs, setOldChairs] = useState<Contributor[]>([]);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [captions, setCaptions] = useState("");
  const [oldCaptions, setOldCaptions] = useState("");
  const [captionLanguage, setCaptionLanguage] = useState("en");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [oldChapters, setOldChapters] = useState<Chapter[]>([]);

  // Tracking for changes
  const [oldTitle, setOldTitle] = useState("");
  const [oldDescription, setOldDescription] = useState("");
  const [oldTags, setOldTags] = useState<string[]>([]);
  const [oldVisibility, setOldVisibility] = useState<"public" | "private">(
    "public"
  );
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

  // Caption status tracking
  const [captionStatus, setCaptionStatus] = useState<CaptionStatus>("loading");
  const [captionsModified, setCaptionsModified] = useState(false);
  const [speakersOrChairsModified, setSpeakersOrChairsModified] =
    useState(false);
  const [chaptersModified, setChaptersModified] = useState(false);
  const [detailsModified, setDetailsModified] = useState(false);

  // Saving states
  const [isSavingCaptions, setIsSavingCaptions] = useState(false);
  const [isDeletingCaptions, setIsDeletingCaptions] = useState(false);
  const [isSavingContributors, setIsSavingContributors] = useState(false);
  const [isSavingChapters, setIsSavingChapters] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false);
  const [isRemovingThumbnail, setIsRemovingThumbnail] = useState(false);
  const [isGeneratingChapters, setIsGeneratingChapters] = useState(false);

  // ─── AI generation loading states ────────────────────────────────────────
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  // ─────────────────────────────────────────────────────────────────────────

  const [error, setError] = useState<string | null>(null);
  const captionPollingRef = useRef<NodeJS.Timeout | null>(null);
  const previewAsideRef = useRef<HTMLElement | null>(null);
  const previewStickyRef = useRef<HTMLDivElement | null>(null);
  const previewBoundaryRef = useRef<HTMLElement | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);

  const myHeaders = useRef(new Headers());
  const [token, setToken] = useState<string>("");
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

  // Fetch video data
  const {
    data: videoData,
    isLoading: isVideoLoading,
    isError: isVideoError,
  } = useQuery({
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
    enabled: !!token && !!videoId,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
  });

  // Populate form with video data
  useEffect(() => {
    if (videoData) {
      setTitle(videoData.title || "");
      setOldTitle(videoData.title || "");
      setDescription(videoData.description || "");
      setOldDescription(videoData.description || "");
      setTags(videoData.tags || []);
      setOldTags(videoData.tags || []);
      setVisibility(videoData.visibility || "private");
      setOldVisibility(videoData.visibility || "private");
      setThumbnailUrl(getVideoThumbnail(videoData) || null);
      const initialThumbnailTime = getInitialThumbnailTime(videoData);
      savedThumbnailTime.current = initialThumbnailTime;
      setSelectedThumbnailTime(initialThumbnailTime);
      setThumbnailTimeInput(formatThumbnailPickerTime(initialThumbnailTime));
      setHasPendingVideoFrame(false);
      setIsThumbnailPickerOpen(false);

      console.log(videoData);

      // Set chapters
      const formattedChapters =
        videoData.chapters?.map((ch) => ({
          timestamp: formatSecondsToTimestamp(ch.startTime ?? 0),
          title: ch.title || "",
        })) || [];
      setChapters(formattedChapters);
      setOldChapters(formattedChapters);

      // Set speakers and chairs
      const peopleArray = videoData.people || [];

      const videoSpeakers = peopleArray
        .filter((p) => p.type === "1")
        .map((p) => ({ id: p.id, name: p.name, image_url: p.image_url }));

      const videoChairs = peopleArray
        .filter((p) => p.type === "0")
        .map((p) => ({ id: p.id, name: p.name, image_url: p.image_url }));

      setSpeakers(videoSpeakers);
      setOldSpeakers(JSON.parse(JSON.stringify(videoSpeakers)));
      setChairs(videoChairs);
      setOldChairs(JSON.parse(JSON.stringify(videoChairs)));

      fetchCaptionsForLanguage("en");
    }
  }, [videoData]);

  useEffect(() => {
    return () => {
      if (pendingThumbnailUrl) {
        URL.revokeObjectURL(pendingThumbnailUrl);
      }
    };
  }, [pendingThumbnailUrl]);

  // Check if details have been modified
  useEffect(() => {
    const titleChanged = title !== oldTitle;
    const descChanged = description !== oldDescription;
    const tagsChanged = JSON.stringify(tags) !== JSON.stringify(oldTags);
    const visChanged = visibility !== oldVisibility;
    setDetailsModified(titleChanged || descChanged || tagsChanged || visChanged);
  }, [
    title,
    oldTitle,
    description,
    oldDescription,
    tags,
    oldTags,
    visibility,
    oldVisibility,
  ]);

  const displayedThumbnailUrl = thumbnailMarkedForRemoval
    ? null
    : pendingThumbnailUrl || thumbnailUrl;
  const thumbnailModified =
    thumbnailMarkedForRemoval ||
    !!pendingThumbnailFile ||
    !!hasPendingVideoFrame;
  const videoDuration = videoData?.duration_seconds ?? 0;
  const maxThumbnailTime = videoDuration > 0 ? Math.max(videoDuration - 0.1, 0) : 0;
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
    if (!videoId) return;

    setIsUploadingThumbnail(true);
    setError(null);

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
        setError(t("editorThumbnailFailed"));
        return;
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
    } catch (err) {
      console.error("Error uploading video thumbnail:", err);
      setError(t("editorThumbnailFailed"));
    } finally {
      setIsUploadingThumbnail(false);
      if (thumbnailInputRef.current) {
        thumbnailInputRef.current.value = "";
      }
    }
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
    if (!videoId || !hasPendingVideoFrame) return;

    setIsUploadingThumbnail(true);
    setError(null);

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
        setError(t("editorThumbnailFailed"));
        return;
      }

      savedThumbnailTime.current = selectedThumbnailTime;
      setThumbnailUrl(await fetchUpdatedThumbnail());
      setHasPendingVideoFrame(false);
      setPendingThumbnailFile(null);
      setPendingThumbnailUrl(null);
      setThumbnailMarkedForRemoval(false);
      setIsThumbnailPickerOpen(false);
    } catch (err) {
      console.error("Error saving generated thumbnail:", err);
      setError(t("editorThumbnailFailed"));
    } finally {
      setIsUploadingThumbnail(false);
    }
  };

  const handleSaveThumbnail = async () => {
    if (!videoId) return;

    if (thumbnailMarkedForRemoval) {
      setIsRemovingThumbnail(true);
      setError(null);

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
          setError(t("editorThumbnailFailed"));
          return;
        }

        savedThumbnailTime.current = 0;
        setThumbnailUrl(await fetchUpdatedThumbnail());
        resetThumbnailSelection();
      } catch (err) {
        console.error("Error removing video thumbnail:", err);
        setError(t("editorThumbnailFailed"));
      } finally {
        setIsRemovingThumbnail(false);
      }

      return;
    }

    if (hasPendingVideoFrame) {
      await handleSaveGeneratedThumbnail();
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
    setHasPendingVideoFrame(false);
    setThumbnailMarkedForRemoval(true);
    setIsThumbnailPickerOpen(false);
    if (thumbnailInputRef.current) {
      thumbnailInputRef.current.value = "";
    }
  };

  // Check if chapters have been modified
  useEffect(() => {
    const chaptersChanged =
      JSON.stringify(chapters) !== JSON.stringify(oldChapters);
    setChaptersModified(chaptersChanged);
  }, [chapters, oldChapters]);

  // Fetch captions when language changes
  const fetchCaptionsForLanguage = async (lang: string) => {
    if (!videoId) return;

    if (captionPollingRef.current) {
      clearTimeout(captionPollingRef.current);
      captionPollingRef.current = null;
    }

    setCaptionStatus("loading");
    setCaptions("");
    setOldCaptions("");
    setCaptionsModified(false);

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
        setCaptions(vttText);
        setOldCaptions(vttText);
        setCaptionStatus("available");
      } else if (response.status === 202) {
        setCaptionStatus("generating");
        captionPollingRef.current = setTimeout(
          () => fetchCaptionsForLanguage(lang),
          5000
        );
      } else if (response.status === 404) {
        setCaptionStatus("not_available");
      } else {
        setCaptionStatus("not_available");
      }
    } catch (err) {
      console.error("Error fetching captions:", err);
      setCaptionStatus("not_available");
    }
  };

  // Auto-generate captions for a language
  const handleGenerateCaptions = async () => {
    if (!videoId) return;

    const selectedLang = EUROPEAN_LANGUAGES.find(
      (l) => l.code === captionLanguage
    );
    if (!selectedLang) return;

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
        setCaptions(vttText);
        // Generation returns a draft; only a successful save updates oldCaptions.
        setCaptionStatus("available");
        setCaptionsModified(true);
      } else {
        setError(t("videoGenerateCaptionsFailed"));
        setCaptionStatus("not_available");
      }
    } catch (err) {
      console.error("Error generating captions:", err);
      setError(t("videoGenerateCaptionsFailed"));
      setCaptionStatus("not_available");
    }
  };

  // ─── AI generation for title, description, tags ───────────────────────────
  const handleGenerateWithAI = async (type: "title" | "description" | "tags") => {
    if (!videoId) return;

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
        setError(t("editorGenerateRequiresEnglish"));
        return;
      }

      const data = await response.json();

      if (type === "title") {
        setTitle(data.result as string);
      } else if (type === "description") {
        setDescription(data.result as string);
      } else {
        // tags — result is an array
        const generated = data.result as string[];
        setTags(Array.from(new Set([...generated])));
      }
    } catch (err) {
      console.error(`Error generating ${type}:`, err);
      setError(t("editorGenerateFailed"));
    } finally {
      setLoading(false);
    }
  };
  // ─────────────────────────────────────────────────────────────────────────

  // Save captions
  const handleSaveCaptions = async () => {
    if (!videoId || !captions) return;

    const selectedLang = EUROPEAN_LANGUAGES.find(
      (l) => l.code === captionLanguage
    );
    if (!selectedLang) return;

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
      } else if (response.status === 502) {
        setError(t("editorTrackNotReady"));
      } else if (response.status === 404) {
        setError(t("videoNotFound"));
      } else {
        setError(t("captionsSaveFailed"));
      }
    } catch (err) {
      console.error("Error saving captions:", err);
      setError(t("captionsSaveFailed"));
    } finally {
      setIsSavingCaptions(false);
    }
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
        setError(t("captionsDeleteFailed"));
      }
    } catch (err) {
      console.error("Error deleting captions:", err);
      setError(t("captionsDeleteFailed"));
    } finally {
      setIsDeletingCaptions(false);
    }
  };

  // Handle caption text change
  const handleCaptionsChange = (newValue: string) => {
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
        setError(t("contributorsSaveFailed"));
      }
    } catch (err) {
      console.error("Error saving contributors:", err);
      setError(t("contributorsSaveFailed"));
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
        setError(t("chaptersSaveFailed"));
      }
    } catch (err) {
      console.error("Error saving chapters:", err);
      setError(t("chaptersSaveFailed"));
    } finally {
      setIsSavingChapters(false);
    }
  };

  // Handle language change
  const handleCaptionLanguageChange = (newLang: string) => {
    setCaptionLanguage(newLang);
    fetchCaptionsForLanguage(newLang);
  };

  const handleRegenerateChapters = async () => {
    if (!videoId) return;

    setIsGeneratingChapters(true);
    try {
      const response = (await fetchFn({
        route: "api/video-moderation/generate-chapters",
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
        setChapters(formattedChapters);
      }
    } catch (err) {
      console.error("Error generating chapters:", err);
      setError(t("chaptersGenerateFailed"));
    } finally {
      setIsGeneratingChapters(false);
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

  const addChapter = () => {
    setChapters([...chapters, { timestamp: "00:00:00", title: "" }]);
  };

  const updateChapter = (
    index: number,
    field: keyof Chapter,
    value: string
  ) => {
    const updated = [...chapters];
    updated[index][field] = value;
    setChapters(updated);
  };

  const removeChapter = (index: number) => {
    setChapters(chapters.filter((_, i) => i !== index));
  };

  // Save video details
  const handleSaveDetails = async () => {
    if (!videoId) return;

    setIsSavingDetails(true);
    try {
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
          }),
        },
      });

      if (response?.success) {
        await refreshVideoPreview();
        setOldTitle(title);
        setOldDescription(description);
        setOldTags([...tags]);
        setOldVisibility(visibility);
        setDetailsModified(false);
      } else {
        setError(t("videoDetailsSaveFailed"));
      }
    } catch (err) {
      console.error("Error saving video:", err);
      setError(t("videoDetailsSaveFailed"));
    } finally {
      setIsSavingDetails(false);
    }
  };

  // Cleanup polling on unmount
  useLayoutEffect(() => {
    return () => {
      if (captionPollingRef.current) clearTimeout(captionPollingRef.current);
    };
  }, []);

  // Remove theater button
  useEffect(() => {
    if (videoData) {
      window.dispatchEvent(
        new CustomEvent("theater-disable", { bubbles: true, composed: true })
      );
    }
  }, [videoData]);

  // Handle missing videoId
  if (!videoId) {
    return (
      <main className={`uploadMain ${statusStyles.page}`}>
        <Sidebar />
        <div className="uploadSide max-w-full! w-full">
          <h1>{t("videoEditTitle")}</h1>
          <div className="errorBanner">
            <p>{t("videoMissingId")}</p>
          </div>
          <button
            type="button"
            className="cancelBtn mt-4"
            onClick={() => navigate("/my-videos")}
          >
            {t("navMyVideos")}
          </button>
        </div>
      </main>
    );
  }

  // Handle video not found
  if (isVideoError) {
    return (
      <main className={`uploadMain ${statusStyles.page}`}>
        <Sidebar />
        <div className="uploadSide max-w-full! w-full">
          <h1>{t("videoEditTitle")}</h1>
          <div className="errorBanner">
            <p>{t("videoNotFoundOrNoPermission")}</p>
          </div>
          <button
            type="button"
            className="cancelBtn mt-4"
            onClick={() => navigate("/my-videos")}
          >
            {t("navMyVideos")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={`uploadMain ${statusStyles.page}`}>
      <Sidebar />
      <div className="uploadSide max-w-full! w-full">
        <h1>{t("videoEditTitle")}</h1>
        <p className="mt-1 mb-3 links">
          {t("videoDetails")} · {t("uploadCaptionsChapters")}
        </p>

        {/* Error Message */}
        {error && (
          <div className="errorBanner">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="dismissErrorBtn"
            >
              ×
            </button>
          </div>
        )}

        {isVideoLoading ? (
          <div className="loadingContainer">
            <div className="uploadSpinner" />
            <p>{t("videoLoadingData")}</p>
          </div>
        ) : (
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
                {/* Video Details Section */}
                <section className="editSection">
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
                        className="saveCaptionsBtn thumbnailSourceButton"
                        onClick={() => thumbnailInputRef.current?.click()}
                        disabled={isUploadingThumbnail || isRemovingThumbnail}
                      >
                        {UploadSVG}
                        {t("uploadSelectFile")}
                      </button>
                      <button
                        type="button"
                        className="saveCaptionsBtn thumbnailSourceButton"
                        aria-pressed={isThumbnailPickerOpen}
                        onClick={handleToggleThumbnailPicker}
                        disabled={!canChooseVideoFrame || isUploadingThumbnail || isRemovingThumbnail}
                      >
                        {isThumbnailPickerOpen ? t("editorBackToImage") : t("editorChooseFrame")}
                      </button>
                    </div>
                    <p className="formHint thumbnailPickerHint">
                      {pendingThumbnailFile
                        ? `${pendingThumbnailFile.name} · ${(pendingThumbnailFile.size / (1024 * 1024)).toFixed(2)} MB`
                        : isThumbnailPickerOpen
                        ? t("editorChooseFrameHelp")
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
                          <label htmlFor="thumbnailFrameTime">{t("jumpToTime")}</label>
                          <input
                            id="thumbnailFrameTime"
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
                            placeholder={`00:00 ${t("uploadOr")} 00:00:00`}
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
                              ? t("saving")
                              : hasPendingVideoFrame
                              ? t("saving")
                              : t("saving")}
                          </>
                        ) : (
                          hasPendingVideoFrame
                            ? t("saveThumbnail")
                            : t("saveThumbnail")
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
                        >
                          {t("cancel")}
                        </button>
                      )}
                    </div>
                    <p className="formHint thumbnailHint">
                      {thumbnailModified ? (
                        <span className="unsavedIndicator">
                          {t("editorUnsavedChanges")}
                        </span>
                      ) : displayedThumbnailUrl ? (
                        t("editorThumbnailHelp")
                      ) : (
                        t("quizNoThumbnail")
                      )}
                    </p>
                  </div>
                </section>

                <section className="editSection">
                  <h2 className="editSectionTitle">{t("videoDetails")}</h2>

                  <div className="formGroup">
                    <label htmlFor="videoTitle">
                      {t("title")}
                      <button
                        type="button"
                        onClick={() => handleGenerateWithAI("title")}
                        disabled={isGeneratingTitle}
                      >
                        {isGeneratingTitle ? (
                          <><div className="uploadSpinner tiny" />{t("editorGenerating")}</>
                        ) : (
                          <>{AISVG}{t("editorGenerateAI")}</>
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

                  <div className="formGroup">
                    <label htmlFor="videoDescription">
                      {t("description")}
                      <button
                        type="button"
                        onClick={() => handleGenerateWithAI("description")}
                        disabled={isGeneratingDescription}
                      >
                        {isGeneratingDescription ? (
                          <><div className="uploadSpinner tiny" />{t("editorGenerating")}</>
                        ) : (
                          <>{AISVG}{t("editorGenerateAI")}</>
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

                  <div className="formGroup">
                    <label htmlFor="videoTags">
                      {t("tags")}
                      <button
                        type="button"
                        onClick={() => handleGenerateWithAI("tags")}
                        disabled={isGeneratingTags}
                      >
                        {isGeneratingTags ? (
                          <><div className="uploadSpinner tiny" />{t("editorGenerating")}</>
                        ) : (
                          <>{AISVG}{t("editorGenerateAI")}</>
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
                          tags.length === 0 ? t("pressEnterToAddTags") : ""
                        }
                      />
                    </div>
                  </div>

                  <div className="formGroup mt-7.5 mb-5">
                    <label htmlFor="videoVisibility">{t("visibility")}</label>
                    <CustomSelect
                      id="videoVisibility"
                      rootClassName={statusStyles.compactSelect}
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
                        ? t("editorPublicHelp")
                        : t("editorPrivateHelp")}
                    </p>
                  </div>

                  <div className="captionsActions">
                    <p className="formHint">
                      {detailsModified && (
                        <span className="unsavedIndicator">
                          {t("editorUnsavedChanges")}
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
                            {t("saving")}
                          </>
                        ) : (
                          t("save")
                        )}
                      </button>
                    </div>
                  </div>
                </section>

                {/* Captions Section */}
                <section className="editSection">
                  <h2 className="editSectionTitle">{t("captions")}</h2>

                  <div className="formGroup">
                    <div className="captionToolbar">
                      <div className="captionToolbarControls">
                        <div className="captionsInputRow">
                          <CustomSelect
                            id="captionLanguageEdit"
                            value={captionLanguage}
                            onChange={handleCaptionLanguageChange}
                            options={EUROPEAN_LANGUAGES.map((lang) => ({
                              value: lang.code,
                              label: `${languageNames.of(lang.code) || lang.name} - ${lang.code}`,
                            }))}
                            ariaLabel={t("spokenLanguage")}
                            triggerClassName="languageSelect"
                            disabled={
                              captionStatus === "loading" ||
                              captionStatus === "generating" ||
                              isSavingCaptions ||
                              isDeletingCaptions
                            }
                          />
                        </div>
                        {captionStatus === "not_available" && (
                          <button
                            type="button"
                            onClick={handleGenerateCaptions}
                            className="generateAIBtn"
                          >
                            {AISVG}{t("editorGenerateAI")}
                          </button>
                        )}
                      </div>
                    </div>

                    <CaptionStatusMessage
                      status={captionStatus}
                      language={captionLanguage === "auto" ? t("autoGeneratedCaptions") : languageNames.of(captionLanguage) || captionLanguage}
                    />

                    {(captionStatus === "available" || captionStatus === "not_available") && (
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
                            {t("editorVttSupport")}
                            {captionsModified && (
                              <span className="unsavedIndicator">
                                {" "}
                                {t("editorUnsavedChanges")}
                              </span>
                            )}
                          </p>
                          <div className="captionsButtonGroup">
                            <button
                              type="button"
                              onClick={handleSaveCaptions}
                              disabled={!captions.trim() || !captionsModified || isSavingCaptions || isDeletingCaptions}
                              className="saveCaptionsBtn"
                            >
                              {isSavingCaptions ? (
                                <>
                                  <div className="uploadSpinner tiny" />
                                  {t("saving")}
                                </>
                              ) : (
                                t("save")
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={handleDeleteCaptions}
                              disabled={captionStatus !== "available" || isDeletingCaptions || isSavingCaptions}
                              className="deleteCaptionsBtn"
                            >
                              {isDeletingCaptions ? (
                                <>
                                  <div className="uploadSpinner tiny" />
                                  {t("editorDeleting")}
                                </>
                              ) : (
                                t("delete")
                              )}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </section>

                {/* Contributors Section */}
                <section className="editSection">
                  <h2 className="editSectionTitle">{t("contributors")}</h2>

                  <div className="formGroup">
                    <ContributorSearch
                      label={t("speakersTitle")}
                      selectedContributors={speakers}
                      onAdd={(contributor) =>
                        handleContributorAdd({ new: contributor })
                      }
                      onRemove={(id) => handleContributorRemove({ id: id })}
                      placeholder={t("searchSpeakersPlaceholder")}
                    />

                    <ContributorSearch
                      label={t("chairsTitle")}
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
                            {t("editorUnsavedChanges")}
                          </span>
                        )}
                      </p>

                      <div className="captionsButtonGroup">
                        <button
                          type="button"
                          onClick={handleSaveContributors}
                          disabled={
                            !speakersOrChairsModified || isSavingContributors
                          }
                          className="saveCaptionsBtn"
                        >
                          {isSavingContributors ? (
                            <>
                              <div className="uploadSpinner tiny" />
                              {t("saving")}
                            </>
                          ) : (
                            t("save")
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Chapters Section */}
                <section className="editSection">
                  <h2 className="editSectionTitle">{t("chapters")}</h2>

                  <div className="formGroup">
                    <label>
                      <button
                        type="button"
                        onClick={handleRegenerateChapters}
                        disabled={
                          isGeneratingChapters || captionStatus !== "available"
                        }
                      >
                        {AISVG}{t("editorGenerateAI")}
                      </button>
                    </label>
                    <div className="chaptersContainer">
                      {isGeneratingChapters ? (
                        <div className="captionsLoadingState">
                          <div className="uploadSpinner small" />
                          <p>{t("uploadPhase_generating_chapters")}</p>
                        </div>
                      ) : chapters.length === 0 ? (
                        <p className="noChapters">
                          {captionStatus !== "available"
                            ? t("editorChaptersRequireCaptions")
                            : t("editorNoChapters")}
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
                        {t("editorAddChapter")}
                      </button>
                    </div>
                    <div className="captionsActions">
                      <p className="formHint">
                        {chaptersModified && (
                          <span className="unsavedIndicator">
                            {t("editorUnsavedChanges")}
                          </span>
                        )}
                      </p>
                      <div className="captionsButtonGroup">
                        <button
                          type="button"
                          onClick={handleSaveChapters}
                          disabled={!chaptersModified || isSavingChapters}
                          className="saveCaptionsBtn"
                        >
                          {isSavingChapters ? (
                            <>
                              <div className="uploadSpinner tiny" />
                              {t("saving")}
                            </>
                          ) : (
                            t("save")
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

              </div>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <section ref={previewBoundaryRef} className="bottomBtns">
          <button
            type="button"
            className="cancelBtn"
            onClick={() => navigate("/my-videos")}
          >
            {t("navMyVideos")}
          </button>
          <Link to={`/video/${videoId}`} className="uploadBtn">
            {t("editorWatchVideo")}
          </Link>
        </section>
      </div>
    </main>
  );
}

export default EditVideoPage;
