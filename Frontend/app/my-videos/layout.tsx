import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Videos", description: "Manage your videos on OptiFlowz.", path: "/my-videos", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
