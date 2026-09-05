import ClientGuard from "~/client-guard";
import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/play";

import ChannelAnalyticsPage from "~/components/channelAnalyticsPage/channelAnalyticsPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Channel Analytics" },
    { name: "description", content: "Review channel performance, engagement, audience, and geographic analytics." },
  ];
}

export default function Page() {
  return <ClientGuard mode="auth" access="channelAnalytics"><Header /><ChannelAnalyticsPage /><Footer /></ClientGuard>;
}
