"use client";

import { Suspense } from "react";
import Loader from "~/components/loaders/loader";
import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import ClientGuard, { type GuardMode } from "./client-guard";
import type { AccessSection } from "~/authorization/permissions";

type ShellMode = GuardMode;

export function SimplePage({
  guard = "public",
  children,
  access,
}: {
  guard?: ShellMode;
  access?: AccessSection;
  children: React.ReactNode;
}) {
  return <ClientGuard mode={guard} access={access}><Suspense fallback={<Loader />}>{children}</Suspense></ClientGuard>;
}

export function FramedPage({
  guard = "public",
  children,
  access,
}: {
  guard?: ShellMode;
  access?: AccessSection;
  children: React.ReactNode;
}) {
  return (
    <ClientGuard mode={guard} access={access}>
      <Header />
      <Suspense fallback={<Loader />}>{children}</Suspense>
      <Footer />
    </ClientGuard>
  );
}
