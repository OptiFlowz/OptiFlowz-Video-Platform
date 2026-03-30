"use client";

import GoogleCallbackPage from "~/routes/googleCallback";
import { SimplePage } from "../page-shell";

export default function Page() {
  return (
    <SimplePage>
      <GoogleCallbackPage />
    </SimplePage>
  );
}
