import ClientGuard from "~/client-guard";
import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/play";

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

export default function Page() {
  return <ClientGuard mode="auth" access="people"><Header /><SpeakersChairsPage /><Footer /></ClientGuard>;
}
