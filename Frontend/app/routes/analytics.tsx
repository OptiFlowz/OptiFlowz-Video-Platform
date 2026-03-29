import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/play";
import { isUserAdmin } from "~/functions";
import Analytics from "~/components/analytics/analyticsPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform Analytics" },
    { name: "description", content: "View detailed analytics for your videos, including views, watch time, and audience demographics. Gain insights to optimize your content and grow your channel." },
  ];
}

function Play(){
    const hasUser =
        !!localStorage.getItem("user") || !!sessionStorage.getItem("user");

    if (!hasUser) {
        window.location.href = `/login?redirect=${encodeURIComponent(
        window.location.pathname + window.location.search + window.location.hash
    )}`;

    if(!isUserAdmin()){
        window.location.href = `/`;
    }
    return null;
  }

  return <>
      <Header />

      <Analytics />

      <Footer />
  </>;
}

export default Play;