"use client";

import PlaylistPage from "~/components/playlistPage/playlistPage";
import { FramedPage } from "../../page-shell";

export default function Page() {
  return (
    <FramedPage guard="auth">
      <PlaylistPage />
    </FramedPage>
  );
}
