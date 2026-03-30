"use client";

import EditPlaylistPage from "~/components/editPlaylistPage/editPlaylistPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="admin">
      <EditPlaylistPage />
    </FramedPage>
  );
}
