"use client";

import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import ClientGuard from "./client-guard";

type ShellMode = "public" | "auth" | "admin" | "uems";

export function SimplePage({
  guard = "public",
  children,
}: {
  guard?: ShellMode;
  children: React.ReactNode;
}) {
  return <ClientGuard mode={guard}>{children}</ClientGuard>;
}

export function FramedPage({
  guard = "public",
  children,
}: {
  guard?: ShellMode;
  children: React.ReactNode;
}) {
  return (
    <ClientGuard mode={guard}>
      <Header />
      {children}
      <Footer />
    </ClientGuard>
  );
}
