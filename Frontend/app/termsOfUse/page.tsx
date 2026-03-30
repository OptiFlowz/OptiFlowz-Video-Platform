"use client";

import TermsOfUsePage from "~/components/termsOfUsePage/termsOfUsePage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage>
      <TermsOfUsePage />
    </FramedPage>
  );
}
