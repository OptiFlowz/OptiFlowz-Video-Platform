"use client";

import ChannelPage from "~/components/channelPage/channelPage";
import { FramedPage } from "../../page-shell";

export default function Page() {
  return (
    <FramedPage guard="public">
      <ChannelPage />
    </FramedPage>
  );
}
