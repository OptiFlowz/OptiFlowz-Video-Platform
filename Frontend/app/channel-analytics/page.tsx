"use client";

import ChannelAnalyticsPage from "~/components/channelAnalyticsPage/channelAnalyticsPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="admin">
      <ChannelAnalyticsPage />
    </FramedPage>
  );
}
