"use client";

import dynamic from "next/dynamic";
import PlayPageSkeleton from "~/components/playPage/PlayPageSkeleton";
import { FramedPage } from "../../page-shell";

const PlayPage = dynamic(() => import("~/components/playPage/playPage"), {
  ssr: false,
  loading: () => <PlayPageSkeleton />,
});

export default function Page() {
  return (
    <FramedPage>
      <PlayPage />
    </FramedPage>
  );
}
