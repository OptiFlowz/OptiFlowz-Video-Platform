"use client";

import LibraryPage from "~/components/libraryPage/libraryPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="auth">
      <LibraryPage />
    </FramedPage>
  );
}
