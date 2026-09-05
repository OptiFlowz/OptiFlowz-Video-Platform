"use client";

import AnalyticsPage from "~/components/analytics/analyticsPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="auth" access="platformAnalytics">
      <AnalyticsPage />
    </FramedPage>
  );
}
