"use client";

import PlatformSettingsPage from "~/components/platformPage/platformSettingsPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="admin">
      <PlatformSettingsPage />
    </FramedPage>
  );
}
