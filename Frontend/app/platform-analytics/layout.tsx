import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Platform analytics", description: "Review platform-wide video and audience analytics.", path: "/platform-analytics", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
