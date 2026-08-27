import type { Metadata } from "next";
import { createPageMetadata } from "~/metadata";

type Props = { children: React.ReactNode; params: Promise<{ type: string }> };

const pages: Record<string, { title: string; description: string; noIndex: boolean }> = {
  "0": { title: "Continue watching", description: "Continue watching your OptiFlowz videos.", noIndex: true },
  "1": { title: "Recommended for you", description: "Personalized video recommendations on OptiFlowz.", noIndex: true },
  "2": { title: "Trending videos", description: "Explore the videos currently trending on OptiFlowz.", noIndex: false },
  "3": { title: "Saved videos", description: "View the videos you saved on OptiFlowz.", noIndex: true },
  "4": { title: "Watch history", description: "View your OptiFlowz watch history.", noIndex: true },
};

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { type } = await params;
  const page = pages[type] || { title: "Videos", description: "Browse videos on OptiFlowz.", noIndex: true };

  return createPageMetadata({ ...page, path: `/videos/${type}` });
}

export default function VideosLayout({ children }: Props) {
  return children;
}
