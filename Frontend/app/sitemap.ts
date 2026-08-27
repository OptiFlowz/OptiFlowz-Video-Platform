import type { MetadataRoute } from "next";
import { SITE_URL } from "./metadata";
import { fetchPublicApi } from "./seo";

type PublicVideoIndex = {
  videos?: Array<{ id: string; created_at?: string }>;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const videoIndex = await fetchPublicApi<PublicVideoIndex>("api/videos/search?q=&limit=100&page=1");
  const videoEntries: MetadataRoute.Sitemap = (videoIndex?.videos || []).map((video) => ({
    url: `${SITE_URL}/video/${video.id}`,
    lastModified: video.created_at ? new Date(video.created_at) : lastModified,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [
    { url: SITE_URL, lastModified, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/videos/2`, lastModified, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/termsOfUse`, lastModified, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/privacyPolicy`, lastModified, changeFrequency: "yearly", priority: 0.2 },
    ...videoEntries,
  ];
}
