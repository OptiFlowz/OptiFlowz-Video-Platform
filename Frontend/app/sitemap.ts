import type { MetadataRoute } from "next";
import { SITE_URL } from "./metadata";
import { fetchPublicApi } from "./seo";

type PublicVideoIndex = {
  videos?: Array<{
    id: string;
    created_at?: string;
    updated_at?: string;
    published_at?: string;
    thumbnail_url?: string;
    visibility?: "public" | "private";
  }>;
  pagination?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    total_pages?: number;
  };
};

const PAGE_SIZE = 100;
const MAX_SITEMAP_URLS = 50_000;

const getVideoPage = (page: number) =>
  fetchPublicApi<PublicVideoIndex>(
    `api/videos/search?q=&limit=${PAGE_SIZE}&page=${page}`,
  );

async function getAllPublicVideos() {
  const firstPage = await getVideoPage(1);
  if (!firstPage) return [];

  const reportedPageCount =
    firstPage.pagination?.totalPages ?? firstPage.pagination?.total_pages ?? 1;
  const reportedTotal = firstPage.pagination?.total ?? firstPage.videos?.length ?? 0;
  const effectivePageSize = Math.max(1, firstPage.pagination?.limit ?? PAGE_SIZE);
  const pageCount = Math.min(
    Math.max(1, reportedPageCount, Math.ceil(reportedTotal / effectivePageSize)),
    Math.ceil(MAX_SITEMAP_URLS / effectivePageSize),
  );
  const pages: PublicVideoIndex[] = [firstPage];

  // Small batches avoid hammering the API on large video libraries.
  for (let start = 2; start <= pageCount; start += 10) {
    const pageNumbers = Array.from(
      { length: Math.min(10, pageCount - start + 1) },
      (_, index) => start + index,
    );
    const batch = await Promise.all(pageNumbers.map(getVideoPage));
    pages.push(...batch.filter((page): page is PublicVideoIndex => Boolean(page)));
  }

  const uniqueVideos = new Map<string, NonNullable<PublicVideoIndex["videos"]>[number]>();
  for (const video of pages.flatMap((page) => page.videos || [])) {
    if (video.id && video.visibility !== "private") uniqueVideos.set(video.id, video);
  }

  return Array.from(uniqueVideos.values()).slice(0, MAX_SITEMAP_URLS);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const videos = await getAllPublicVideos();
  const videoEntries: MetadataRoute.Sitemap = videos.map((video) => ({
    url: `${SITE_URL}/video/${encodeURIComponent(video.id)}`,
    lastModified: video.updated_at || video.published_at || video.created_at || lastModified,
    changeFrequency: "weekly",
    priority: 0.7,
    images: video.thumbnail_url ? [video.thumbnail_url] : undefined,
  }));

  return [
    { url: SITE_URL, lastModified, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/videos/2`, lastModified, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/termsOfUse`, lastModified, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/privacyPolicy`, lastModified, changeFrequency: "yearly", priority: 0.2 },
    ...videoEntries,
  ];
}
