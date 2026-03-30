"use client";

import AccountPage from "~/components/accountPage/accountPage";
import { FramedPage } from "../page-shell";

export default function Page() {
  return (
    <FramedPage guard="auth">
      <AccountPage />
    </FramedPage>
  );
}
