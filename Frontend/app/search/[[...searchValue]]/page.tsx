"use client";

import SearchPage from "~/components/searchPage/searchPage";
import { FramedPage } from "../../page-shell";

export default function Page() {
  return (
    <FramedPage guard="auth">
      <SearchPage />
    </FramedPage>
  );
}
