"use client";

import EventsPage from "~/components/eventsPage/eventsPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="auth">
      <EventsPage />
    </FramedPage>
  );
}
