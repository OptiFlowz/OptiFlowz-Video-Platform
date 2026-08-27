import type { Metadata } from "next";
import type { FetchChannelT } from "~/types";
import { createPageMetadata, SITE_URL } from "~/metadata";
import { fetchPublicApi, jsonLd } from "~/seo";

type Props = { children: React.ReactNode; params: Promise<{ id: string }> };

const getChannel = (id: string) =>
  fetchPublicApi<FetchChannelT>(`api/channels/${encodeURIComponent(id)}`);

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { id } = await params;
  const channel = (await getChannel(id))?.channel;

  if (!channel) {
    return createPageMetadata({ title: "Channel", path: `/channel/${id}`, noIndex: true });
  }

  return createPageMetadata({
    title: channel.full_name,
    description: channel.description || `Watch videos from ${channel.full_name} on OptiFlowz.`,
    path: `/channel/${id}`,
    image: channel.image_url,
  });
}

export default async function ChannelLayout({ children, params }: Props) {
  const { id } = await params;
  const channel = (await getChannel(id))?.channel;
  const channelJsonLd = channel
    ? {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        name: channel.full_name,
        description: channel.description,
        url: `${SITE_URL}/channel/${id}`,
        mainEntity: {
          "@type": "Person",
          name: channel.full_name,
          image: channel.image_url || undefined,
        },
      }
    : null;

  return (
    <>
      {channelJsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(channelJsonLd) }} />
      ) : null}
      {children}
    </>
  );
}
