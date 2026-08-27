import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Platform settings", description: "Manage OptiFlowz platform settings.", path: "/platform-settings", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
