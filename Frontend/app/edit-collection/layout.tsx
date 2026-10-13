import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Edit collection", description: "Edit an OptiFlowz collection.", path: "/edit-collection", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
