"use client";

import QuizzesPage from "~/components/quizzesPage/quizzesPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="admin">
      <QuizzesPage />
    </FramedPage>
  );
}
