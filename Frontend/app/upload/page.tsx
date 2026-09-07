"use client";

import { UploadSessionSlot } from "~/components/uploadPage/uploadSession";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="auth" access="upload">
      <UploadSessionSlot />
    </FramedPage>
  );
}
