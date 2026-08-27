import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Speakers and chairs", description: "Manage speakers and chairs on OptiFlowz.", path: "/speakers-chairs", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
