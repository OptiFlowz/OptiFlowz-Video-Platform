"use client";

import PrivacyPolicyPage from "~/components/privacyPolicyPage/privacyPolicyPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage>
      <PrivacyPolicyPage />
    </FramedPage>
  );
}
