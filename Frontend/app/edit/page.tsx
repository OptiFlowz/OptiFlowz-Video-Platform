"use client";

import EditVideoPage from "~/components/editVideoPage/editVideoPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="admin">
      <EditVideoPage />
    </FramedPage>
  );
}
