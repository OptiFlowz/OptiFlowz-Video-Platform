import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/play";
import ClientGuard from "~/client-guard";
import MyVideos from "~/components/myVideosPage/myVideosPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

export default function Page() {
  return <ClientGuard mode="auth" access="videos"><Header /><MyVideos /><Footer /></ClientGuard>;
}
