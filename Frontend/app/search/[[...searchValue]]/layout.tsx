import type { Metadata } from "next";
import { createPageMetadata } from "~/metadata";

type Props = { children: React.ReactNode; params: Promise<{ searchValue?: string[] }> };

const getSearchTerm = (segments?: string[]) => {
  if (!segments?.length) return "";
  try {
    return decodeURIComponent(segments.join("/"));
  } catch {
    return segments.join("/");
  }
};

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { searchValue } = await params;
  const term = getSearchTerm(searchValue).trim();

  return createPageMetadata({
    title: term ? `Search results for “${term}”` : "Search",
    description: term
      ? `Find videos, playlists, and people matching “${term}” on OptiFlowz.`
      : "Search videos, playlists, and people on OptiFlowz.",
    path: term ? `/search/${encodeURIComponent(term)}` : "/search",
    noIndex: true,
    follow: true,
  });
}

export default function SearchLayout({ children }: Props) {
  return children;
}
