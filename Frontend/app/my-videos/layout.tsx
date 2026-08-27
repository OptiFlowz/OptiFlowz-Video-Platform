import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "My videos", description: "Manage your videos on OptiFlowz.", path: "/my-videos", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
