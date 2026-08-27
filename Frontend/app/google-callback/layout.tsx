import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Signing in", description: "Completing your OptiFlowz sign-in.", path: "/google-callback", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
