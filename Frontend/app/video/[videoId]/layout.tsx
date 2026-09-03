import type { Metadata } from "next";
import { cache } from "react";
import type { VideoT } from "~/types";
import { cleanMetaDescription, createPageMetadata, SITE_NAME, SITE_URL } from "~/metadata";
import { fetchPublicApi, jsonLd, toIsoDuration } from "~/seo";

type Props = {
  children: React.ReactNode;
  params: Promise<{ videoId: string }>;
};

const getVideo = cache((id: string) =>
  fetchPublicApi<VideoT>(`api/videos/${encodeURIComponent(id)}`),
);

const getPeopleByRole = (video: VideoT, role: 0 | 1) =>
  (video.people || []).filter((person) => Number(person.type) === role);

const getVideoThumbnail = (video: VideoT) =>
  video.thumbnail_url ||
  (video.mux_playback_id
    ? `https://image.mux.com/${video.mux_playback_id}/thumbnail.jpg?width=1280&height=720&fit_mode=preserve`
    : null);

const unique = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

const cleanStructuredDescription = (value: string | null | undefined) =>
  value
    ?.replace(/<[^>]*>/g, " ")
    .replace(/[`*_~#[\]()>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const personJsonLd = (person: VideoT["people"][number], role: "Speaker" | "Chair") => ({
  "@type": "Person",
  name: person.name,
  image: person.image_url || undefined,
  jobTitle: role,
});

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { videoId } = await params;
  const video = await getVideo(videoId);

  if (!video) {
    return createPageMetadata({
      title: "Video",
      description: "Watch this video on OptiFlowz.",
      path: `/video/${videoId}`,
      noIndex: true,
    });
  }

  if (video.visibility !== "public") {
    return createPageMetadata({
      title: "Private video",
      description: "This video is private.",
      path: `/video/${videoId}`,
      noIndex: true,
    });
  }

  const speakers = getPeopleByRole(video, 1);
  const chairs = getPeopleByRole(video, 0);
  const speakerNames = unique(speakers.map((person) => person.name));
  const chairNames = unique(chairs.map((person) => person.name));
  const contributorNames = unique([...speakerNames, ...chairNames]);
  const thumbnail = getVideoThumbnail(video);
  const description = cleanMetaDescription(
    video.description,
    [
      `Watch ${video.title} on ${SITE_NAME}.`,
      speakerNames.length ? `Speakers: ${speakerNames.join(", ")}.` : null,
      chairNames.length ? `Chairs: ${chairNames.join(", ")}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
  );

  const metadata = createPageMetadata({
    title: video.title,
    description,
    path: `/video/${videoId}`,
    image: thumbnail,
    keywords: unique([
      ...(video.tags || []),
      ...(video.categories || []).map((category) => category.name),
      ...contributorNames,
      video.uploader_name,
    ]),
  });

  return {
    ...metadata,
    authors: speakerNames.length
      ? speakerNames.map((name) => ({ name }))
      : video.uploader_name
        ? [{ name: video.uploader_name }]
        : undefined,
    creator: video.uploader_name || contributorNames[0] || SITE_NAME,
    openGraph: {
      ...metadata.openGraph,
      type: "video.other",
      images: thumbnail
        ? [{ url: thumbnail, width: 1280, height: 720, alt: `${video.title} — video thumbnail` }]
        : metadata.openGraph?.images,
      videos: video.stream_url
        ? [{ url: video.stream_url, secureUrl: video.stream_url, type: "application/x-mpegURL" }]
        : undefined,
    },
    other: {
      "video:duration": Math.max(0, Math.round(Number(video.duration_seconds) || 0)),
      "video:release_date": video.published_at || video.created_at,
      ...(speakerNames.length ? { "video:speaker": speakerNames } : {}),
      ...(chairNames.length ? { "video:chair": chairNames } : {}),
    },
  };
}

export default async function VideoLayout({ children, params }: Props) {
  const { videoId } = await params;
  const video = await getVideo(videoId);

  const speakers = video ? getPeopleByRole(video, 1) : [];
  const chairs = video ? getPeopleByRole(video, 0) : [];
  const thumbnail = video ? getVideoThumbnail(video) : null;
  const canonicalUrl = `${SITE_URL}/video/${encodeURIComponent(videoId)}`;

  const videoJsonLd = video?.visibility === "public" && thumbnail
    ? {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "@id": `${canonicalUrl}#video`,
        name: video.title,
        description:
          cleanStructuredDescription(video.description) || `Watch ${video.title} on ${SITE_NAME}.`,
        thumbnailUrl: [thumbnail],
        uploadDate: video.published_at || video.created_at,
        datePublished: video.published_at || video.created_at,
        dateModified: video.updated_at || undefined,
        duration: toIsoDuration(video.duration_seconds),
        contentUrl: video.stream_url || undefined,
        embedUrl: canonicalUrl,
        url: canonicalUrl,
        keywords: (video.tags || []).join(", ") || undefined,
        genre: video.categories?.length
          ? video.categories.map((category) => category.name)
          : undefined,
        creator: video.uploader_name
          ? {
              "@type": "Person",
              name: video.uploader_name,
              url: video.uploader_id
                ? `${SITE_URL}/channel/${encodeURIComponent(video.uploader_id)}`
                : undefined,
            }
          : undefined,
        contributor:
          speakers.length || chairs.length
            ? [
                ...speakers.map((person) => personJsonLd(person, "Speaker")),
                ...chairs.map((person) => personJsonLd(person, "Chair")),
              ]
            : undefined,
        interactionStatistic: Number.isFinite(Number(video.view_count))
          ? {
              "@type": "InteractionCounter",
              interactionType: { "@type": "WatchAction" },
              userInteractionCount: Number(video.view_count),
            }
          : undefined,
        potentialAction: {
          "@type": "WatchAction",
          target: canonicalUrl,
        },
        isAccessibleForFree: true,
        publisher: {
          "@type": "Organization",
          name: SITE_NAME,
          url: "https://optiflowz.com",
          logo: {
            "@type": "ImageObject",
            url: `${SITE_URL}/favicon.ico`,
          },
        },
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": canonicalUrl,
        },
      }
    : null;

  return (
    <>
      {videoJsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(videoJsonLd) }} />
      ) : null}
      {children}
    </>
  );
}
