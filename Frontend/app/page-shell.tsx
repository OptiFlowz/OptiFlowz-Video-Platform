"use client";

import { Suspense } from "react";
import Loader from "~/components/loaders/loader";
import Footer from "~/components/footer/footer";
import NavigationFrame from "~/components/header/navigationFrame";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const drawerOnly = !!access || pathname.startsWith("/video/") || pathname.startsWith("/live/");
  return (
    <ClientGuard mode={guard} access={access}>
      <NavigationFrame drawerOnly={drawerOnly}>
        <Suspense fallback={<Loader />}>{children}</Suspense>
        <Footer />
      </NavigationFrame>
    </ClientGuard>
  );
}
