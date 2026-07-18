import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import PlatformUsersPage from "~/components/platformPage/platformUsersPage";
import type { Route } from "./+types/play";
import { isUserAdmin } from "~/functions";

export function meta({}: Route.MetaArgs) {
  return [{ title: "OptiFlowz Platform Users" }];
}

export default function PlatformUsersRoute() {
  const hasUser = !!localStorage.getItem("user") || !!sessionStorage.getItem("user");

  if (!hasUser) {
    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`;
    return null;
  }

  if (!isUserAdmin()) {
    window.location.href = "/";
    return null;
  }

  return <><Header /><PlatformUsersPage /><Footer /></>;
}
