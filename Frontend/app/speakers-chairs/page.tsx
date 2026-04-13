"use client";

import SpeakersChairsPage from "~/components/speakersChairsPage/speakersChairsPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="admin">
      <SpeakersChairsPage />
    </FramedPage>
  );
}
