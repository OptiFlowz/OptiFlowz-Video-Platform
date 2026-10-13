import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "My collections", description: "Manage your OptiFlowz collections.", path: "/my-collections", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
