"use client";

import UemsReadingList from "~/components/uemsPage/uemsPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="uems">
      <UemsReadingList />
    </FramedPage>
  );
}
