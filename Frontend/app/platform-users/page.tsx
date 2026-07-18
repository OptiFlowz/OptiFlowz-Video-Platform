"use client";

import PlatformUsersPage from "~/components/platformPage/platformUsersPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="admin">
      <PlatformUsersPage />
    </FramedPage>
  );
}
