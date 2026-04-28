import { Link, useNavigate, useSearchParams } from "react-router";
import {
  useState,
  useRef,
  useLayoutEffect,
  type KeyboardEvent,
  useEffect,
} from "react";
import { useQuery } from "@tanstack/react-query";
import MuxPlayer from "@mux/mux-player-react";
import type MuxPlayerElement from "@mux/mux-player";
import { AISVG, UploadSVG } from "~/constants";
import { env } from "~/env";
import ContributorSearch from "~/components/uploadPage/contributorSearch";
import { fetchFn } from "~/API";
import { getToken } from "~/functions";
import { EUROPEAN_LANGUAGES } from "~/constants";
import { loadMediaTheme } from "../playPage/playerCollection/loadMediaTheme";
import Sidebar from "../myVideosPage/sidebar/sidebar";
import { useConstrainedSticky } from "~/components/shared/useConstrainedSticky";

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

interface VideoData {
  id: string;
  title: string;
  description: string;
  mux_playback_id: string;
  duration_seconds: number;
  thumbnail_url: string;
  stream_url: string;
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

  const rounded = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;

  if (mins >= 60) {
    return formatSecondsToTimestamp(rounded);
  }

  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function getMuxThumbnailUrl(playbackId: string, time: number): string {
  const safeTime = Math.max(0, Number(time.toFixed(2)));
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?time=${safeTime}&width=1280`;
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
  const fallbackTime = duration > 1 ? Math.min(duration / 3, Math.max(duration - 0.1, 0)) : 0;
  const thumbnailUrl = video?.thumbnail_url;

  if (!thumbnailUrl) {
    return fallbackTime;
  }

  try {
    const parsedUrl = new URL(thumbnailUrl);
    const timeValue = parsedUrl.searchParams.get("time");
    if (!timeValue) {
      return fallbackTime;
    }

    const parsedTime = Number(timeValue);
    if (!Number.isFinite(parsedTime)) {
      return fallbackTime;
    }

    if (duration <= 0) {
      return Math.max(0, parsedTime);
    }

    return Math.min(Math.max(parsedTime, 0), Math.max(duration - 0.1, 0));
  } catch {
    return fallbackTime;
  }
}

// ─── VideoPreview is defined OUTSIDE EditVideoPage ───────────────────────────
interface VideoPreviewProps {
  isVideoLoading: boolean;
  videoData: VideoData | null | undefined;
  title: string;
  chapters: Chapter[];
  thumbnailUrl?: string | null;
}

interface ThumbnailImageProps {
  src: string;
  alt: string;
  className?: string;
}

const ThumbnailImage = ({ src, alt, className }: ThumbnailImageProps) => {
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [hasFailed, setHasFailed] = useState(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const revealTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setDisplaySrc(null);
    setIsLoading(true);
    setAttempt(0);
    setHasFailed(false);
  }, [src]);

  useEffect(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (revealTimeoutRef.current) {
      clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }

    const separator = src.includes("?") ? "&" : "?";
    const nextSrc = `${src}${separator}previewAttempt=${attempt}`;
    const revealDelay = attempt === 0 ? 180 : Math.min(350 * attempt, 900);

    revealTimeoutRef.current = setTimeout(() => {
      setDisplaySrc(nextSrc);
    }, revealDelay);

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
      }
    };
  }, [src, attempt]);

  const handleLoad = () => {
    setHasFailed(false);
    setIsLoading(false);
  };

  const handleError = () => {
    if (attempt >= 3) {
      setIsLoading(false);
      setHasFailed(true);
      return;
    }

    setIsLoading(true);
    setHasFailed(false);

    const retryDelay = 400 + attempt * 450;
    retryTimeoutRef.current = setTimeout(() => {
      setAttempt((currentAttempt) => currentAttempt + 1);
    }, retryDelay);
  };

  return (
    <div className="thumbnailImageShell">
      {isLoading && (
        <div className="thumbnailImageLoader">
          <div className="uploadSpinner tiny" />
          <span>{attempt === 0 ? "Loading frame..." : "Retrying frame..."}</span>
        </div>
      )}
      {hasFailed && !isLoading ? (
        <div className="thumbnailImageFallback">
          <span>Preview unavailable right now</span>
          <button
            type="button"
            className="thumbnailImageRetryBtn"
            onClick={() => {
              setHasFailed(false);
              setIsLoading(true);
              setAttempt(0);
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {displaySrc ? (
        <img
          src={displaySrc}
          alt={alt}
          className={`${className ?? ""} ${isLoading ? "thumbnailImagePending" : ""}`.trim()}
          onLoad={handleLoad}
          onError={handleError}
        />
      ) : null}
    </div>
  );
};

const VideoPreview = ({
  isVideoLoading,
  videoData,
  title,
  chapters,
  thumbnailUrl,
}: VideoPreviewProps) => {
  const [isThemeReady, setIsThemeReady] = useState(false);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const playerRef = useRef<MuxPlayerElement | null>(null);

  useEffect(() => {
    setMetadataLoaded(false);
  }, [videoData?.mux_playback_id]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !metadataLoaded) return;

    const muxChapters = (chapters ?? [])
      .map((chapter) => ({
        startTime: parseTimestampToSeconds(chapter.timestamp),
        value: String(chapter.title ?? ""),
      }))
      .filter((chapter) => Number.isFinite(chapter.startTime) && chapter.value.length > 0);

    if (!muxChapters.length) return;

    try {
      player.addChapters(muxChapters);
    } catch {
      // ignore preview chapter registration errors
    }
  }, [chapters, metadataLoaded]);

  useEffect(() => {
    let cancelled = false;

    void loadMediaTheme().then(() => {
      if (!cancelled) {
        setIsThemeReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (isVideoLoading) {
    return (
      <div className="videoPreviewContainer">
        <div className="videoPreviewLoading">
          <div className="uploadSpinner" />
          <p>Loading video preview...</p>
        </div>
      </div>
    );
  }

  if (!videoData?.mux_playback_id) {
    return (
      <div className="videoPreviewContainer">
        <div className="videoPreviewPlaceholder">
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
          <p>Video preview unavailable</p>
        </div>
      </div>
    );
  }

  return (
    <div className="videoPreviewContainer">
      <div className="videoPreviewWrapper">
        {isThemeReady ? (
          <MuxPlayer
            theme="optiflowz-theme"
            themeProps={{ videotitlee: title, chapterLenght: chapters?.length || 0 }}
            playbackId={videoData.mux_playback_id}
            autoPlay={false}
            playsInline
            volume={0.1}
            ref={playerRef as any}
            onLoadedMetadata={() => setMetadataLoaded(true)}
            style={{
              width: "100%",
              aspectRatio: "16 / 9",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          />
        ) : (
          <div className="videoPreviewLoading">
            <div className="uploadSpinner" />
            <p>Loading video preview...</p>
          </div>
        )}
      </div>
      <div className="videoPreviewInfo">
        <h3 className="videoPreviewTitle">{title || "Untitled Video"}</h3>
        {videoData.duration_seconds && (
          <p className="videoPreviewDuration">
            Duration: {formatSecondsToTimestamp(videoData.duration_seconds)}
          </p>
        )}
        {thumbnailUrl ? (
          <div className="videoPreviewThumbBlock">
            <p className="videoPreviewThumbLabel">Thumbnail</p>
            <ThumbnailImage
              src={thumbnailUrl}
              alt="Video thumbnail"
              className="videoPreviewThumbImage"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};
// ─────────────────────────────────────────────────────────────────────────────

function EditVideoPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const videoId = searchParams.get("video");

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
  const [pendingGeneratedThumbnailUrl, setPendingGeneratedThumbnailUrl] =
    useState<string | null>(null);
  const [thumbnailTimeInput, setThumbnailTimeInput] = useState("00:00");

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
        },
      }) as Promise<VideoData | null>,
    enabled: !!token && !!videoId,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
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
      setThumbnailUrl(videoData.thumbnail_url || null);
      const initialThumbnailTime = getInitialThumbnailTime(videoData);
      setSelectedThumbnailTime(initialThumbnailTime);
      setThumbnailTimeInput(formatThumbnailPickerTime(initialThumbnailTime));
      setPendingGeneratedThumbnailUrl(null);
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
    : pendingGeneratedThumbnailUrl || pendingThumbnailUrl || thumbnailUrl;
  const thumbnailModified =
    thumbnailMarkedForRemoval ||
    !!pendingThumbnailFile ||
    !!pendingGeneratedThumbnailUrl;
  const videoDuration = videoData?.duration_seconds ?? 0;
  const maxThumbnailTime = videoDuration > 0 ? Math.max(videoDuration - 0.1, 0) : 0;
  const canChooseVideoFrame = !!videoData?.mux_playback_id && videoDuration > 0;

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
        setError("Failed to upload video thumbnail.");
        return;
      }

      const nextThumbnailUrl = response.video?.thumbnail_url || null;
      setThumbnailUrl(nextThumbnailUrl);
      setPendingThumbnailFile(null);
      setPendingThumbnailUrl(null);
      setPendingGeneratedThumbnailUrl(null);
      setThumbnailMarkedForRemoval(false);
      setIsThumbnailPickerOpen(false);
    } catch (err) {
      console.error("Error uploading video thumbnail:", err);
      setError("Failed to upload video thumbnail.");
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
    setPendingGeneratedThumbnailUrl(null);
    setThumbnailMarkedForRemoval(false);
    const initialThumbnailTime = getInitialThumbnailTime(videoData);
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
    setPendingGeneratedThumbnailUrl(null);
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
        const initialTime = selectedThumbnailTime || getInitialThumbnailTime(videoData);
        setSelectedThumbnailTime(initialTime);
        setThumbnailTimeInput(formatThumbnailPickerTime(initialTime));
        if (videoData?.mux_playback_id) {
          setPendingGeneratedThumbnailUrl(
            getMuxThumbnailUrl(videoData.mux_playback_id, initialTime)
          );
        }
      } else {
        setPendingGeneratedThumbnailUrl(null);
      }

      return nextValue;
    });
  };

  const applyThumbnailTime = (nextTime: number) => {
    const clampedTime = clampThumbnailTime(nextTime, videoDuration);
    setSelectedThumbnailTime(clampedTime);
    setThumbnailTimeInput(formatThumbnailPickerTime(clampedTime));

    if (videoData?.mux_playback_id) {
      setPendingGeneratedThumbnailUrl(
        getMuxThumbnailUrl(videoData.mux_playback_id, clampedTime)
      );
    }
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
    if (!videoId || !pendingGeneratedThumbnailUrl) return;

    setIsUploadingThumbnail(true);
    setError(null);

    try {
      const response = await fetchFn<{ success: boolean }>({
        route: `api/video-moderation/video-details/${videoId}`,
        options: {
          method: "PATCH",
          headers: myHeaders.current,
          body: JSON.stringify({
            thumbnail_url: pendingGeneratedThumbnailUrl,
          }),
        },
      });

      if (!response?.success) {
        setError("Failed to save video thumbnail.");
        return;
      }

      setThumbnailUrl(pendingGeneratedThumbnailUrl);
      setPendingGeneratedThumbnailUrl(null);
      setPendingThumbnailFile(null);
      setPendingThumbnailUrl(null);
      setThumbnailMarkedForRemoval(false);
      setIsThumbnailPickerOpen(false);
    } catch (err) {
      console.error("Error saving generated thumbnail:", err);
      setError("Failed to save video thumbnail.");
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
          route: `api/video-moderation/${videoId}/thumbnail`,
          options: {
            method: "POST",
            headers,
            body: JSON.stringify({
              file: null,
            }),
          },
        });

        if (!response?.success) {
          setError("Failed to remove video thumbnail.");
          return;
        }

        setThumbnailUrl(null);
        resetThumbnailSelection();
      } catch (err) {
        console.error("Error removing video thumbnail:", err);
        setError("Failed to remove video thumbnail.");
      } finally {
        setIsRemovingThumbnail(false);
      }

      return;
    }

    if (pendingGeneratedThumbnailUrl) {
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
    setPendingGeneratedThumbnailUrl(null);
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
        setOldCaptions(vttText);
        setCaptionStatus("available");
        setCaptionsModified(true);
      } else {
        setError("Failed to generate captions. Please try again.");
        setCaptionStatus("not_available");
      }
    } catch (err) {
      console.error("Error generating captions:", err);
      setError("Failed to generate captions. Please try again.");
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
        setError(`Failed to generate ${type}. Make sure the video has English subtitles added.`);
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
      setError(`Failed to generate ${type}. Please try again.`);
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
        setOldCaptions(captions);
        setCaptionsModified(false);
      } else if (response.status === 502) {
        setError("Mux track is not ready yet. Please try again later.");
      } else if (response.status === 404) {
        setError("Video not found.");
      } else {
        setError("Failed to save captions.");
      }
    } catch (err) {
      console.error("Error saving captions:", err);
      setError("Failed to save captions.");
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
        setCaptions("");
        setOldCaptions("");
        setCaptionStatus("not_available");
        setCaptionsModified(false);
      } else {
        setError("Failed to delete captions.");
      }
    } catch (err) {
      console.error("Error deleting captions:", err);
      setError("Failed to delete captions.");
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
        setOldSpeakers([...speakers]);
        setOldChairs([...chairs]);
        setSpeakersOrChairsModified(false);
      } else {
        setError("Failed to save speakers and chairs.");
      }
    } catch (err) {
      console.error("Error saving contributors:", err);
      setError("Failed to save speakers and chairs.");
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
        setOldChapters([...chapters]);
        setChaptersModified(false);
      } else {
        setError("Failed to save chapters.");
      }
    } catch (err) {
      console.error("Error saving chapters:", err);
      setError("Failed to save chapters.");
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
        setChapters(formattedChapters);
      }
    } catch (err) {
      console.error("Error generating chapters:", err);
      setError("Failed to generate chapters.");
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
        setOldTitle(title);
        setOldDescription(description);
        setOldTags([...tags]);
        setOldVisibility(visibility);
        setDetailsModified(false);
      } else {
        setError("Failed to save video details.");
      }
    } catch (err) {
      console.error("Error saving video:", err);
      setError("Failed to save video details.");
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
      <main className="uploadMain">
        <Sidebar />
        <div className="uploadSide max-w-full! w-full">
          <h1>Edit Video</h1>
          <div className="errorBanner">
            <p>No video ID provided. Please select a video to edit.</p>
          </div>
          <button
            type="button"
            className="cancelBtn mt-4"
            onClick={() => navigate("/my-videos")}
          >
            Go to My Videos
          </button>
        </div>
      </main>
    );
  }

  // Handle video not found
  if (isVideoError) {
    return (
      <main className="uploadMain">
        <Sidebar />
        <div className="uploadSide max-w-full! w-full">
          <h1>Edit Video</h1>
          <div className="errorBanner">
            <p>Video not found or you don't have permission to edit it.</p>
          </div>
          <button
            type="button"
            className="cancelBtn mt-4"
            onClick={() => navigate("/my-videos")}
          >
            Go to My Videos
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="uploadMain">
      <Sidebar />
      <div className="uploadSide max-w-full! w-full">
        <h1>Edit Video</h1>
        <p className="mt-1 mb-3 links">
          Make changes to your video's details, captions, and chapters.
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
            <p>Loading video data...</p>
          </div>
        ) : (
          <div className="stepContentWithPreview">
            <aside ref={previewAsideRef} className="stepContentSidebar">
              <div ref={previewStickyRef} style={previewStickyStyle}>
                <VideoPreview
                  isVideoLoading={isVideoLoading}
                  videoData={videoData}
                  title={title}
                  chapters={chapters}
                  thumbnailUrl={displayedThumbnailUrl}
                />
              </div>
            </aside>
            <div className="stepContentMain">
              <div className="videoDetailsForm">
                {/* Video Details Section */}
                <section className="editSection">
                  <h2 className="editSectionTitle">Thumbnail</h2>

                  <div className="thumbnailSourceActions">
                    <div className="thumbnailSourceHeading">
                      <button
                        type="button"
                        className={`thumbnailPickerToggle ${isThumbnailPickerOpen ? "active" : ""}`}
                        onClick={handleToggleThumbnailPicker}
                        disabled={!canChooseVideoFrame || isUploadingThumbnail || isRemovingThumbnail}
                      >
                        {isThumbnailPickerOpen ? "Back to upload" : "Choose from video"}
                      </button>
                      <p className="formHint thumbnailPickerHint">
                        {canChooseVideoFrame
                          ? isThumbnailPickerOpen
                            ? "Choose the exact frame you want and save it as the thumbnail."
                            : "Pick a frame directly from the video timeline instead of uploading an image."
                          : "Frame selection becomes available once the video preview and duration are ready."}
                      </p>
                    </div>
                  </div>

                  {!isThumbnailPickerOpen ? (
                    <div
                      className={`uploadZone ${pendingThumbnailFile ? "hasFile" : ""}`}
                      onClick={() =>
                        !pendingThumbnailFile && thumbnailInputRef.current?.click()
                      }
                    >
                      <input
                        type="file"
                        ref={thumbnailInputRef}
                        accept="image/*"
                        onChange={handleThumbnailFileSelect}
                        hidden
                      />
                      {pendingThumbnailFile ? (
                        <div className="fileInfo">
                          {UploadSVG}
                          <p className="fileName">{pendingThumbnailFile.name}</p>
                          <p className="fileSize">
                            {(pendingThumbnailFile.size / (1024 * 1024)).toFixed(2)} MB
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
                  ) : null}

                  {isThumbnailPickerOpen && canChooseVideoFrame ? (
                    <div className="thumbnailPickerCard">
                      <div className="thumbnailPickerPreview">
                        {pendingGeneratedThumbnailUrl ? (
                          <ThumbnailImage
                            src={pendingGeneratedThumbnailUrl}
                            alt={`Thumbnail preview at ${formatThumbnailPickerTime(selectedThumbnailTime)}`}
                            className="thumbnailPickerImage"
                          />
                        ) : (
                          <div className="thumbnailPickerPreviewPlaceholder">
                            <div className="uploadSpinner tiny" />
                            <span>Preparing frame preview...</span>
                          </div>
                        )}
                      </div>

                      <div className="thumbnailPickerControls">
                        <div className="thumbnailPickerTimeRow">
                          <span>Selected frame</span>
                          <strong>{formatThumbnailPickerTime(selectedThumbnailTime)}</strong>
                        </div>
                        <div className="thumbnailPickerTimeInputRow">
                          <label htmlFor="thumbnailFrameTime">Jump to time</label>
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
                              : pendingGeneratedThumbnailUrl
                              ? "Setting..."
                              : "Uploading..."}
                          </>
                        ) : (
                          pendingGeneratedThumbnailUrl
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
                        "Current thumbnail is set. Select a new image, then save it explicitly."
                      ) : (
                        "No thumbnail selected yet."
                      )}
                    </p>
                  </div>
                </section>

                <section className="editSection">
                  <h2 className="editSectionTitle">Video Details</h2>

                  <div className="formGroup">
                    <label htmlFor="videoTitle">
                      Title
                      <button
                        type="button"
                        onClick={() => handleGenerateWithAI("title")}
                        disabled={isGeneratingTitle}
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
                      placeholder="Enter video title"
                      maxLength={100}
                    />
                    <span className="charCount">{title.length}/100</span>
                  </div>

                  <div className="formGroup">
                    <label htmlFor="videoDescription">
                      Description
                      <button
                        type="button"
                        onClick={() => handleGenerateWithAI("description")}
                        disabled={isGeneratingDescription}
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
                      placeholder="Enter video description"
                      rows={5}
                      maxLength={5000}
                    />
                    <span className="charCount">{description.length}/5000</span>
                  </div>

                  <div className="formGroup">
                    <label htmlFor="videoTags">
                      Tags
                      <button
                        type="button"
                        onClick={() => handleGenerateWithAI("tags")}
                        disabled={isGeneratingTags}
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

                  <div className="formGroup mt-7.5 mb-5">
                    <label htmlFor="videoVisibility">Visibility</label>
                    <select
                      id="videoVisibility"
                      value={visibility}
                      onChange={(e) =>
                        setVisibility(e.target.value as "public" | "private")
                      }
                      className="visibilitySelect"
                    >
                      <option value="public">Public</option>
                      <option value="private">Private</option>
                    </select>
                    <p className="formHint">
                      {visibility === "public"
                        ? "Anyone can view this video."
                        : "Only you and people you share the link with can view this video."}
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

                {/* Captions Section */}
                <section className="editSection">
                  <h2 className="editSectionTitle">Captions</h2>

                  <div className="formGroup">
                    <label htmlFor="videoCaptions">
                      <div className="flex items-center gap-2">
                        <div className="captionsInputRow">
                          <select
                            id="captionLanguageEdit"
                            value={captionLanguage}
                            onChange={(e) =>
                              handleCaptionLanguageChange(e.target.value)
                            }
                            className="languageSelect"
                            disabled={
                              captionStatus === "loading" ||
                              captionStatus === "generating" ||
                              isSavingCaptions ||
                              isDeletingCaptions
                            }
                          >
                            {EUROPEAN_LANGUAGES.map((lang) => (
                              <option key={lang.code} value={lang.code}>
                                {lang.name} - {lang.code}
                              </option>
                            ))}
                          </select>
                        </div>
                        {captionStatus === "not_available" && (
                          <button
                            type="button"
                            onClick={handleGenerateCaptions}
                            className="generateAIBtn"
                          >
                            {AISVG}&nbsp;Generate with AI
                          </button>
                        )}
                      </div>
                    </label>

                    {captionStatus === "loading" && (
                      <div className="captionsLoadingState">
                        <div className="uploadSpinner small" />
                        <p>Checking for captions...</p>
                      </div>
                    )}

                    {captionStatus === "generating" && (
                      <div className="captionsLoadingState">
                        <div className="uploadSpinner small" />
                        <p>Generating captions...</p>
                      </div>
                    )}

                    {(captionStatus === "available" || captionStatus === "not_available") && (
                      <>
                        <textarea
                          id="videoCaptions"
                          value={captions}
                          onChange={(e) => handleCaptionsChange(e.target.value)}
                          placeholder="Enter captions in VTT format"
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
                              disabled={!captionsModified || isSavingCaptions}
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
                              disabled={isDeletingCaptions || isSavingCaptions}
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
                    )}
                  </div>
                </section>

                {/* Contributors Section */}
                <section className="editSection">
                  <h2 className="editSectionTitle">Contributors</h2>

                  <div className="formGroup">
                    <ContributorSearch
                      label="Speakers"
                      selectedContributors={speakers}
                      onAdd={(contributor) =>
                        handleContributorAdd({ new: contributor })
                      }
                      onRemove={(id) => handleContributorRemove({ id: id })}
                      placeholder="Search for speakers..."
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
                      placeholder="Search for chairs..."
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
                            !speakersOrChairsModified || isSavingContributors
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
                </section>

                {/* Chapters Section */}
                <section className="editSection">
                  <h2 className="editSectionTitle">Chapters</h2>

                  <div className="formGroup">
                    <label>
                      <button
                        type="button"
                        onClick={handleRegenerateChapters}
                        disabled={
                          isGeneratingChapters || captionStatus !== "available"
                        }
                      >
                        {AISVG}&nbsp;Generate with AI
                      </button>
                    </label>
                    <div className="chaptersContainer">
                      {isGeneratingChapters ? (
                        <div className="captionsLoadingState">
                          <div className="uploadSpinner small" />
                          <p>Generating chapters...</p>
                        </div>
                      ) : chapters.length === 0 ? (
                        <p className="noChapters">
                          {captionStatus !== "available"
                            ? "Captions are required to generate chapters."
                            : "No chapters. Click 'Generate with AI' to create chapters or add them manually."}
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
                              placeholder="Chapter title"
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
                          disabled={!chaptersModified || isSavingChapters}
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
            Back to My Videos
          </button>
          <Link to={`/video/${videoId}`} className="uploadBtn">
            View Video
          </Link>
        </section>
      </div>
    </main>
  );
}

export default EditVideoPage;
