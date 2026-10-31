import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Posts", description: "Manage your channel posts.", path: "/my-posts", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
