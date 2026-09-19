type RecommendedVideoAuthor = { uploader_id?: string | null; uploader_name?: string };

// Preserve recommendation order, but do not let repeated videos use up the author limit.
export function recommendedPostAuthors<T extends RecommendedVideoAuthor>(videos: T[]): Array<T & { uploader_id: string }> {
  const authors: Array<T & { uploader_id: string }> = [];
  const seen = new Set<string>();
  for (const video of videos) {
    const id = video.uploader_id?.trim().toLowerCase();
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    authors.push({ ...video, uploader_id: id });
    if (authors.length === 5) break;
  }
  return authors;
}
