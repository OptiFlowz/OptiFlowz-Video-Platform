import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import PlatformUsersPage from "~/components/platformPage/platformUsersPage";
import type { Route } from "./+types/play";
import ClientGuard from "~/client-guard";

export function meta({}: Route.MetaArgs) {
  return [{ title: "OptiFlowz Platform Users" }];
}

export default function Page() {
  return <ClientGuard mode="auth" access="platformUsers"><Header /><PlatformUsersPage /><Footer /></ClientGuard>;
}
