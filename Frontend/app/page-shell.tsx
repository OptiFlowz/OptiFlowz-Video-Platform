"use client";

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
  return <ClientGuard mode={guard} access={access}>{children}</ClientGuard>;
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
      {children}
      <Footer />
    </ClientGuard>
  );
}
