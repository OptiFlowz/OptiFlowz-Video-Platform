"use client";

import CollectionEditor from "~/components/collections/CollectionEditor";
import { FramedPage } from "../page-shell";

export default function Page() {
  return <FramedPage guard="auth" access="editCollection"><CollectionEditor /></FramedPage>;
}
