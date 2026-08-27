import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Quiz", description: "Complete a video quiz on OptiFlowz.", path: "/quiz", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
