"use client";

import MyVideosPage from "~/components/myVideosPage/myVideosPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="admin">
      <MyVideosPage />
    </FramedPage>
  );
}
