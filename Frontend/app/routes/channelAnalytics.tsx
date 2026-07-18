import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/play";
import { isUserAdmin } from "~/functions";
import ChannelAnalyticsPage from "~/components/channelAnalyticsPage/channelAnalyticsPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Channel Analytics" },
    { name: "description", content: "Review channel performance, engagement, audience, and geographic analytics." },
  ];
}

export default function ChannelAnalyticsRoute() {
  const hasUser = !!localStorage.getItem("user") || !!sessionStorage.getItem("user");

  if (!hasUser) {
    window.location.href = `/login?redirect=${encodeURIComponent(
      window.location.pathname + window.location.search + window.location.hash,
    )}`;
    return null;
  }

  if (!isUserAdmin()) {
    window.location.href = "/";
    return null;
  }

  return (
    <>
      <Header />
      <ChannelAnalyticsPage />
      <Footer />
    </>
  );
}
