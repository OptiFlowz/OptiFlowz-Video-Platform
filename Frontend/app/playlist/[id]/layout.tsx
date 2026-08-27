import type { Metadata } from "next";
import type { FetchPlaylistT } from "~/types";
import { createPageMetadata, SITE_URL } from "~/metadata";
import { fetchPublicApi, jsonLd } from "~/seo";

type Props = { children: React.ReactNode; params: Promise<{ id: string }> };

const getPlaylist = (id: string) =>
  fetchPublicApi<FetchPlaylistT>(`api/playlists/${encodeURIComponent(id)}`);

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { id } = await params;
  const playlist = (await getPlaylist(id))?.playlist;

  if (!playlist) {
    return createPageMetadata({ title: "Playlist", path: `/playlist/${id}`, noIndex: true });
  }

  if (playlist.status === "private") {
    return createPageMetadata({
      title: "Private playlist",
      description: "This playlist is private.",
      path: `/playlist/${id}`,
      noIndex: true,
    });
  }

  return createPageMetadata({
    title: playlist.title,
    description: playlist.description || `Watch ${playlist.video_count} videos in this OptiFlowz playlist.`,
    path: `/playlist/${id}`,
    image: playlist.thumbnail_url,
    keywords: playlist.tags || undefined,
  });
}

export default async function PlaylistLayout({ children, params }: Props) {
  const { id } = await params;
  const playlist = (await getPlaylist(id))?.playlist;
  const playlistJsonLd = playlist && playlist.status !== "private"
    ? {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: playlist.title,
        description: playlist.description,
        url: `${SITE_URL}/playlist/${id}`,
        image: playlist.thumbnail_url,
        numberOfItems: playlist.video_count,
      }
    : null;

  return (
    <>
      {playlistJsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(playlistJsonLd) }} />
      ) : null}
      {children}
    </>
  );
}
