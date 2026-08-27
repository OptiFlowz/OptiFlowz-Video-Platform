import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Quizzes", description: "Create and manage OptiFlowz video quizzes.", path: "/quizzes", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
