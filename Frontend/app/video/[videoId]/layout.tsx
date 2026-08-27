import type { Metadata } from "next";
import type { VideoT } from "~/types";
import { createPageMetadata, SITE_NAME, SITE_URL } from "~/metadata";
import { fetchPublicApi, jsonLd, toIsoDuration } from "~/seo";

type Props = {
  children: React.ReactNode;
  params: Promise<{ videoId: string }>;
};

const getVideo = (id: string) => fetchPublicApi<VideoT>(`api/videos/${encodeURIComponent(id)}`);

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

  const metadata = createPageMetadata({
    title: video.title,
    description: video.description,
    path: `/video/${videoId}`,
    image: video.thumbnail_url,
    keywords: video.tags,
  });

  return {
    ...metadata,
    openGraph: {
      ...metadata.openGraph,
      type: "video.other",
      videos: [{ url: video.stream_url, type: "application/x-mpegURL" }],
    },
  };
}

export default async function VideoLayout({ children, params }: Props) {
  const { videoId } = await params;
  const video = await getVideo(videoId);

  const videoJsonLd = video?.visibility === "public"
    ? {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        name: video.title,
        description: video.description,
        thumbnailUrl: [video.thumbnail_url],
        uploadDate: video.published_at || video.created_at,
        duration: toIsoDuration(video.duration_seconds),
        contentUrl: video.stream_url,
        embedUrl: `${SITE_URL}/video/${videoId}`,
        interactionStatistic: {
          "@type": "InteractionCounter",
          interactionType: { "@type": "WatchAction" },
          userInteractionCount: video.view_count,
        },
        publisher: { "@type": "Organization", name: SITE_NAME, url: "https://optiflowz.com" },
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
