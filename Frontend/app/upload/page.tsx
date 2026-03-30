"use client";

import UploadPage from "~/components/uploadPage/uploadPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="admin">
      <UploadPage />
    </FramedPage>
  );
}
