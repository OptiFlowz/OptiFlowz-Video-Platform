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
import MuxPlayer from "@mux/mux-player-react";
import { AISVG, CloseSVG, UploadSVG } from "~/constants";
import { env } from "~/env";
import ContributorSearch from "./contributorSearch";
import { fetchFn } from "~/API";
import { getToken } from "~/functions";
import { EUROPEAN_LANGUAGES } from "~/constants";
import { loadMediaTheme } from "../playPage/playerCollection/loadMediaTheme";
import Sidebar from "../myVideosPage/sidebar/sidebar";

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

interface VideoData {
  id: string;
  title: string;
  description: string;
  mux_playback_id: string;
  duration_seconds: number;
  thumbnail_url: string;
  stream_url: string;
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

const PHASE_LABELS: Record<ProcessingPhase, string> = {
  idle: "",
  initializing: "Initializing upload...",
  uploading: "Uploading video...",
  processing_asset: "Processing video...",
  generating_captions: "Generating captions...",
  generating_chapters: "Generating chapters...",
  saving_initial_data: "Saving video data...",
  complete: "Complete!",
};

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

function VideoPreview({
  isVideoLoading,
  videoData,
  title,
}: {
  isVideoLoading: boolean;
  videoData: VideoData | null | undefined;
  title: string;
}) {
  const [isThemeReady, setIsThemeReady] = useState(false);

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
            themeProps={{ videotitlee: title, chapterLenght: 0 }}
            playbackId={videoData.mux_playback_id}
            autoPlay={false}
            playsInline
            volume={0.1}
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
      </div>
    </div>
  );
}

function UploadPage() {
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
  const [captionLanguage, setCaptionLanguage] = useState("en");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [oldChapters, setOldChapters] = useState<Chapter[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [videoId, setVideoId] = useState<string | null>(null);
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
  const captionPollingRef = useRef<NodeJS.Timeout | null>(null);

  // Step 3 tracking
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  const myHeaders = useRef(new Headers());
  const [token, setToken] = useState<string>("");
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Store speakers/chairs at upload time to save after chapters generate
  const pendingSpeakersRef = useRef<Contributor[]>([]);
  const pendingChairsRef = useRef<Contributor[]>([]);

  const isProcessing =
    processingPhase !== "idle" && processingPhase !== "complete";
  const isUploaded = !!videoId && processingPhase === "complete";

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
        },
      }) as Promise<VideoData | null>,
    enabled: !!token && !!videoId && processingPhase === "complete",
  });

  // Check if chapters have been modified
  useEffect(() => {
    const chaptersChanged =
      JSON.stringify(chapters) !== JSON.stringify(oldChapters);
    setChaptersModified(chaptersChanged);
  }, [chapters, oldChapters]);

  // Fetch captions when language changes (only in step 2 and when video is uploaded)
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
    } catch (error) {
      console.error("Error fetching captions:", error);
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

  // Handle language change in step 2
  const handleCaptionLanguageChange = (newLang: string) => {
    setCaptionLanguage(newLang);
    if (currentStep === 2 && videoId) {
      fetchCaptionsForLanguage(newLang);
    }
  };

  const uploadFileToMux = async (uploadUrl: string, file: File) => {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
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
      xhr.send(file);
    });
  };

  const pollForCaptions = async (vid: string, lang: string) => {
    setProcessingPhase("processing_asset");

    const poll = async () => {
      try {
        const response = await fetch(
        `${env.apiBaseUrl || ""}/api/video-moderation/subtitle/${vid}?lang=${lang}`,
          {
            method: "GET",
            headers: myHeaders.current,
          }
        );

        if (response.status === 202) {
          const data = await response.json();
          if (data.code === "ASSET_PROCESSING") {
            setProcessingPhase("processing_asset");
          } else if (data.code === "CAPTIONS_PROCESSING") {
            setProcessingPhase("generating_captions");
          }
          pollingRef.current = setTimeout(poll, 5000);
        } else if (response.status === 200) {
          const vttText = await response.text();
          setCaptions(vttText);
          setOldCaptions(vttText);
          setCaptionStatus("available");
          setCaptionsModified(false);
          await generateChapters(vid, lang);
        } else if (response.status === 404) {
          setProcessingError("No captions available for this language.");
          setCaptionStatus("not_available");
          // Still save speakers/chairs even if captions fail
          await saveInitialData(vid, []);
        } else {
          setProcessingError("Failed to fetch captions.");
          setCaptionStatus("not_available");
          await saveInitialData(vid, []);
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
    setProcessingPhase("saving_initial_data");

    try {
      const chaptersPayload = generatedChapters.map((ch) => ({
        title: ch.title,
        startTime: parseTimestampToSeconds(ch.timestamp),
      }));

      const response = await fetchFn<{ success: boolean }>({
        route: `api/video-moderation/video-details/${vid}`,
        options: {
          method: "PATCH",
          headers: myHeaders.current,
          body: JSON.stringify({
            speakers: pendingSpeakersRef.current.map((s) => s.id),
            chairs: pendingChairsRef.current.map((c) => c.id),
            chapters: chaptersPayload,
          }),
        },
      });

      if (response?.success) {
        // Update old values to reflect saved state
        setOldSpeakers([...pendingSpeakersRef.current]);
        setOldChairs([...pendingChairsRef.current]);
        setOldChapters([...generatedChapters]);
        setSpeakersOrChairsModified(false);
        setChaptersModified(false);
      } else {
        console.error("Failed to save initial data");
      }
    } catch (error) {
      console.error("Error saving initial data:", error);
    }

    setProcessingPhase("complete");
    setCurrentStep(2);
    document.scrollingElement?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const generateChapters = async (vid: string, lang: string) => {
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
        setChapters(generatedChapters);
      }
    } catch (error) {
      console.error("Error generating chapters:", error);
    }

    // Save speakers, chairs, and chapters
    await saveInitialData(vid, generatedChapters);
  };

  const handleRegenerateChapters = async () => {
    if (!videoId) return;

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
        setChapters(formattedChapters);
      }
      setProcessingPhase("complete");
    } catch (error) {
      console.error("Error generating chapters:", error);
      setProcessingPhase("complete");
    }
  };

  const initiateUpload = async () => {
    if (!videoFile || !title.trim()) return;

    setProcessingPhase("initializing");
    setProcessingError(null);
    setUploadProgress(0);

    const selectedLang = EUROPEAN_LANGUAGES.find(
      (l) => l.code === captionLanguage
    );
    if (!selectedLang) return;

    // Store current speakers/chairs to save after chapters generate
    pendingSpeakersRef.current = [...speakers];
    pendingChairsRef.current = [...chairs];

    try {
      const initiateResponse = (await fetchFn({
        route: "api/videos/upload/initiate",
        options: {
          method: "POST",
          headers: myHeaders.current,
          body: JSON.stringify({
            title: title.trim(),
            language_code: captionLanguage,
            language_name: selectedLang.name,
          }),
        },
      })) as UploadInitiateResponse | null;

      if (!initiateResponse?.upload?.upload_url) {
        throw new Error("Failed to initiate upload");
      }

      const { video_id, upload } = initiateResponse;
      setVideoId(video_id);

      setProcessingPhase("uploading");
      await uploadFileToMux(upload.upload_url, videoFile);

      pollForCaptions(video_id, captionLanguage);
    } catch (error) {
      console.error("Upload error:", error);
      setProcessingPhase("idle");
      setProcessingError("Failed to upload video. Please try again.");
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isUploaded) {
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
    if (isUploaded) return;

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("video/")) {
      setVideoFile(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isUploaded) return;

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
    if (isUploaded) return;

    setVideoFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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

  const handleNext = () => {
    if (currentStep === 1) {
      if (isUploaded) {
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
        navigate("/my-videos");
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
    { number: 1, label: "Upload Video" },
    { number: 2, label: "Captions & Chapters" },
    { number: 3, label: "Video Details" },
  ];

  // Cleanup polling on unmount
  useLayoutEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
      if (captionPollingRef.current) clearTimeout(captionPollingRef.current);
    };
  }, []);

  // Remove theater button
  useEffect(() => {
    if (currentStep === 2 && videoData)
      window.dispatchEvent(
        new CustomEvent("theater-disable", { bubbles: true, composed: true })
      );
  }, [currentStep, videoData]);

  return (
    <>
      <main className={`uploadMain`}>
        <Sidebar />
        <div
          className={`uploadSide ${currentStep > 1 ? "max-w-325 w-full" : ""}`}
        >
          <h1>Upload new video</h1>
          <p className="mt-3 links">
            By submitting videos to this platform, you agree to our{" "}
            <Link to="/termsOfUse">Terms of Use</Link> and{" "}
            <Link to="/privacyPolicy">Privacy Policy</Link>.
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

          {/* Upload Loader Overlay */}
          {isProcessing && (
            <div className="uploadOverlay">
              <div className="uploadLoaderContainer">
                <div className="uploadSpinner" />
                <p className="uploadingText">
                  {processingPhase === "uploading"
                    ? `${PHASE_LABELS[processingPhase]} ${uploadProgress}%`
                    : PHASE_LABELS[processingPhase]}
                </p>
                <div className="uploadProgressBar">
                  <div
                    className="uploadProgressFill"
                    style={{
                      width:
                        processingPhase === "uploading"
                          ? `${uploadProgress}%`
                          : "100%",
                    }}
                  />
                </div>
              </div>
            </div>
          )}

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
                className={`uploadZone ${isDragging ? "dragging" : ""} ${videoFile ? "hasFile" : ""} ${isUploaded ? "disabled" : ""}`}
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
                  disabled={isUploaded}
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
                    {!isUploaded && (
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
                    <p>Drag and drop video file here</p>
                    <span>or</span>
                    <button type="button" className="selectFileBtn">
                      Select file
                    </button>
                  </div>
                )}
              </div>
              <div className="formGroup mt-7.5">
                <label htmlFor="muxTitle">Title</label>
                <input
                  type="text"
                  id="muxTitle"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter mux title"
                  maxLength={100}
                  disabled={isUploaded}
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
              </div>
              <div className="formGroup mt-2">
                <label htmlFor="captionLanguage">Spoken language</label>
                <div className="captionsInputRow">
                  <select
                    id="captionLanguage"
                    value={captionLanguage}
                    onChange={(e) => setCaptionLanguage(e.target.value)}
                    className={`languageSelect ${isUploaded ? "disabled" : ""}`}
                    disabled={isUploaded}
                  >
                    {EUROPEAN_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name} - {lang.code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Captions & Chapters */}
          {currentStep === 2 && (
            <div className="stepContentWithPreview">
              <aside className="stepContentSidebar">
                <VideoPreview isVideoLoading={isVideoLoading} videoData={videoData} title={title} />
              </aside>
              <div className="stepContentMain">
                <div className="videoDetailsForm">
                  <div className="formGroup editSection">
                    <label htmlFor="videoCaptions">
                      Captions
                      <div className="flex items-center gap-2">
                        <div className="captionsInputRow">
                          <select
                            id="captionLanguageStep2"
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

                    {captionStatus === "not_available" && (
                      <div className="captionsNotAvailable">
                        {CloseSVG}
                        <p>
                          No captions available for{" "}
                          {
                            EUROPEAN_LANGUAGES.find(
                              (l) => l.code === captionLanguage
                            )?.name
                          }
                          . Click "Generate with AI" to create them.
                        </p>
                      </div>
                    )}

                    {captionStatus === "available" && (
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

                  <div className="formGroup editSection mt-10">
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

                  <div className="formGroup editSection mt-10">
                    <label>
                      Chapters
                      <button
                        type="button"
                        onClick={handleRegenerateChapters}
                        disabled={
                          processingPhase === "generating_chapters" ||
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
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Video Details */}
          {currentStep === 3 && (
            <div className="stepContentWithPreview">
              <aside className="stepContentSidebar">
                <VideoPreview isVideoLoading={isVideoLoading} videoData={videoData} title={title} />
              </aside>
              <div className="stepContentMain">
                <div className="videoDetailsForm">
                  <div className="formGroup editSection">
                    <label htmlFor="videoTitle">
                      Title
                      <button type="button">{AISVG}&nbsp;Generate with AI</button>
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

                  <div className="formGroup editSection">
                    <label htmlFor="videoDescription">
                      Description
                      <button type="button">{AISVG}&nbsp;Generate with AI</button>
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

                  <div className="formGroup editSection">
                    <label htmlFor="videoTags">
                      Tags
                      <button type="button">{AISVG}&nbsp;Generate with AI</button>
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
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <section className="bottomBtns">
            {currentStep === 1 ? (
              <button
                type="button"
                className="cancelBtn"
                disabled={isProcessing}
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="cancelBtn"
                onClick={handleBack}
                disabled={isProcessing}
              >
                Back
              </button>
            )}
            {currentStep < 3 ? (
              <button
                type="button"
                className="uploadBtn"
                disabled={!canProceed() || isProcessing}
                onClick={handleNext}
              >
                {isProcessing ? "Processing..." : "Next"}
              </button>
            ) : (
              <button
                type="submit"
                className="uploadBtn"
                disabled={!canProceed() || isSavingDetails}
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
