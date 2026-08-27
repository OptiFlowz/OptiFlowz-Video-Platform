import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Upload video", description: "Upload a video to OptiFlowz.", path: "/upload", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
