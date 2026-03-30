"use client";

import PlayPage from "~/components/playPage/playPage";
import { FramedPage } from "../../page-shell";

export default function Page() {
  return (
    <FramedPage guard="auth">
      <PlayPage />
    </FramedPage>
  );
}
