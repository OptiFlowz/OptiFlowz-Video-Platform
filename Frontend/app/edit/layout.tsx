import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Edit video", description: "Edit video details on OptiFlowz.", path: "/edit", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
