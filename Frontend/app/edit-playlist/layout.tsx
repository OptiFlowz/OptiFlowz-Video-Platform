import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Edit playlist", description: "Edit an OptiFlowz playlist.", path: "/edit-playlist", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
