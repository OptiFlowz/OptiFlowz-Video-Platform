"use client";

import VideoAnalyticsPage from "~/components/videoAnalyticsPage/videoAnalyticsPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="admin">
      <VideoAnalyticsPage />
    </FramedPage>
  );
}
