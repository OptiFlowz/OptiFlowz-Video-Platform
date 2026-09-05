import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import PlatformSettingsPage from "~/components/platformPage/platformSettingsPage";
import type { Route } from "./+types/play";
import ClientGuard from "~/client-guard";

export function meta({}: Route.MetaArgs) {
  return [{ title: "OptiFlowz Platform Settings" }];
}

export default function Page() {
  return <ClientGuard mode="auth" access="platformSettings"><Header /><PlatformSettingsPage /><Footer /></ClientGuard>;
}
