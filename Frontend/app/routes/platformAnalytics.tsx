import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import AnalyticsPage from "~/components/analytics/analyticsPage";
import type { Route } from "./+types/play";
import ClientGuard from "~/client-guard";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Platform Analytics" },
    { name: "description", content: "Generate platform analytics reports." },
  ];
}

export default function Page() {
  return <ClientGuard mode="auth" access="platformAnalytics"><Header /><AnalyticsPage /><Footer /></ClientGuard>;
}
