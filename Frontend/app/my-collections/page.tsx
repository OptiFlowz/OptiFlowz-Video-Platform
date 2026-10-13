"use client";

import MyCollectionsPage from "~/components/collections/MyCollectionsPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return <FramedPage guard="auth" access="collections"><MyCollectionsPage /></FramedPage>;
}
