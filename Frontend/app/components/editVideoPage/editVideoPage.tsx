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
import { AISVG } from "~/constants";
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

// ─── VideoPreview is defined OUTSIDE EditVideoPage ───────────────────────────
interface VideoPreviewProps {
  isVideoLoading: boolean;
  videoData: VideoData | null | undefined;
  title: string;
}

const VideoPreview = ({ isVideoLoading, videoData, title }: VideoPreviewProps) => {
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
        `${import.meta.env.VITE_FIRST || ""}/api/video-moderation/subtitle/${videoId}?lang=${lang}`,
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
        `${import.meta.env.VITE_FIRST || ""}/api/video-moderation/subtitle/autogenerate/${videoId}?lang=${captionLanguage}&name=${encodeURIComponent(selectedLang.name)}`,
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
        `${import.meta.env.VITE_FIRST || ""}/api/video-moderation/details/autogenerate/${videoId}?type=${type}`,
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
        `${import.meta.env.VITE_FIRST || ""}/api/video-moderation/subtitle/replacev2/${videoId}?lang=${captionLanguage}&name=${selectedLang.name}`,
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
        `${import.meta.env.VITE_FIRST || ""}/api/video-moderation/subtitle/${videoId}?lang=${captionLanguage}`,
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
        <p className="mt-3 links">
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
                />
              </div>
            </aside>
            <div className="stepContentMain">
              <div className="videoDetailsForm">
                {/* Video Details Section */}
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
