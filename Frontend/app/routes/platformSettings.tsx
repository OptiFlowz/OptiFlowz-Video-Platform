import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import PlatformSettingsPage from "~/components/platformPage/platformSettingsPage";
import type { Route } from "./+types/play";
import { isUserAdmin } from "~/functions";

export function meta({}: Route.MetaArgs) {
  return [{ title: "OptiFlowz Platform Settings" }];
}

export default function PlatformSettingsRoute() {
  const hasUser = !!localStorage.getItem("user") || !!sessionStorage.getItem("user");

  if (!hasUser) {
    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`;
    return null;
  }

  if (!isUserAdmin()) {
    window.location.href = "/";
    return null;
  }

  return <><Header /><PlatformSettingsPage /><Footer /></>;
}
