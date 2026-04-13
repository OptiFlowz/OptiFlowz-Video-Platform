import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/play";
import { isUserAdmin } from "~/functions";
import SpeakersChairsPage from "~/components/speakersChairsPage/speakersChairsPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform Speakers and Chairs" },
    {
      name: "description",
      content:
        "Manage speaker and chair person records for the OptiFlowz Video Platform admin area.",
    },
  ];
}

function Play() {
  const hasUser =
    !!localStorage.getItem("user") || !!sessionStorage.getItem("user");

  if (!hasUser) {
    window.location.href = `/login?redirect=${encodeURIComponent(
      window.location.pathname + window.location.search + window.location.hash
    )}`;

    if (!isUserAdmin()) {
      window.location.href = `/`;
    }
    return null;
  }

  return (
    <>
      <Header />

      <SpeakersChairsPage />

      <Footer />
    </>
  );
}

export default Play;
