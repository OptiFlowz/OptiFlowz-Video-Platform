"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getStoredUser, isUserAdmin, isUserUEMS } from "~/functions";

type GuardMode = "public" | "auth" | "admin" | "uems";

export default function ClientGuard({
  mode,
  children,
}: {
  mode: GuardMode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(mode === "public");

  useEffect(() => {
    if (mode === "public") {
      setAllowed(true);
      return;
    }

    const hasUser = !!getStoredUser();
    const redirectTarget = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (!hasUser) {
      router.replace(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
      setAllowed(false);
      return;
    }

    if (mode === "admin" && !isUserAdmin()) {
      router.replace("/");
      setAllowed(false);
      return;
    }

    if (mode === "uems" && !isUserUEMS()) {
      router.replace(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
      setAllowed(false);
      return;
    }

    setAllowed(true);
  }, [mode, router]);

  if (!allowed) {
    return null;
  }

  return <>{children}</>;
}
