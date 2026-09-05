import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/play";
import ClientGuard from "~/client-guard";
import Analytics from "~/components/analytics/analyticsPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform Analytics" },
    { name: "description", content: "View detailed analytics for your videos, including views, watch time, and audience demographics. Gain insights to optimize your content and grow your channel." },
  ];
}

export default function Page() {
  return <ClientGuard mode="auth" access="platformAnalytics"><Header /><Analytics /><Footer /></ClientGuard>;
}
