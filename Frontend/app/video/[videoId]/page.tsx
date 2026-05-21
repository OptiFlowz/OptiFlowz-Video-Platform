"use client";

import dynamic from "next/dynamic";
import { FramedPage } from "../../page-shell";

const PlayPage = dynamic(() => import("~/components/playPage/playPage"), {
  ssr: false,
  loading: () => (
    <main className="play px-0 py-7.5">
      <div className="flex flex-col gap-5 overflow-x-hidden">
        <div id="playerCanvas" style={{ height: "100%" }}>
          <div className="player-skeleton" aria-hidden="true">
            <div className="player-skeleton__controls">
              <span className="player-skeleton__chip player-skeleton__chip--wide"></span>
              <span className="player-skeleton__chip"></span>
              <span className="player-skeleton__chip player-skeleton__chip--short"></span>
            </div>
          </div>
        </div>
      </div>
    </main>
  ),
});

export default function Page() {
  return (
    <FramedPage>
      <PlayPage />
    </FramedPage>
  );
}
