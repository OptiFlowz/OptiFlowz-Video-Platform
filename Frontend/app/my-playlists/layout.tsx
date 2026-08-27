import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "My playlists", description: "Manage your OptiFlowz playlists.", path: "/my-playlists", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
