"use client";

import HomePage from "~/components/homePage/homePage";
import { FramedPage } from "./page-shell";

export default function Page() {
  return (
    <FramedPage guard="public">
      <HomePage />
    </FramedPage>
  );
}
