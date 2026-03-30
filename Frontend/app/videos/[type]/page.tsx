"use client";

import VideosPage from "~/components/videosPage/videosPage";
import { FramedPage } from "../../page-shell";

export default function Page() {
  return (
    <FramedPage guard="auth">
      <VideosPage />
    </FramedPage>
  );
}
