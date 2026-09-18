"use client";

import PersonPage from "~/components/personPage/personPage";
import { FramedPage } from "../../page-shell";

export default function Page() {
  return <FramedPage guard="public"><PersonPage /></FramedPage>;
}
