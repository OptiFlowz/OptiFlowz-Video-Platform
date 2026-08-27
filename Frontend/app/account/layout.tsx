import { createPageMetadata } from "~/metadata";
export const metadata = createPageMetadata({ title: "Account", description: "Manage your OptiFlowz account and preferences.", path: "/account", noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
