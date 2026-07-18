import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import AnalyticsPage from "~/components/analytics/analyticsPage";
import type { Route } from "./+types/play";
import { isUserAdmin } from "~/functions";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Platform Analytics" },
    { name: "description", content: "Generate platform analytics reports." },
  ];
}

export default function PlatformAnalyticsRoute() {
  const hasUser = !!localStorage.getItem("user") || !!sessionStorage.getItem("user");

  if (!hasUser) {
    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`;
    return null;
  }

  if (!isUserAdmin()) {
    window.location.href = "/";
    return null;
  }

  return <><Header /><AnalyticsPage /><Footer /></>;
}
