import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/videos";
import VideosPage from "~/components/videosPage/videosPage";
import { getToken } from "~/functions";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function Videos(){
  const isTrendingPage = window.location.pathname.endsWith("/videos/2");

  if (!isTrendingPage && !getToken()) {
    window.location.href = `/login?redirect=${encodeURIComponent(
      window.location.pathname + window.location.search + window.location.hash
    )}`;
    return null;
  }

  return <>
    <Header />

    <VideosPage />

    <Footer />
  </>;
}

export default Videos;
