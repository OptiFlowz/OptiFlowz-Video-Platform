"use client";

import MyPlaylistsPage from "~/components/myPlaylists/myPlaylistsPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="auth" access="playlists">
      <MyPlaylistsPage />
    </FramedPage>
  );
}
