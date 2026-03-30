"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import PageLoader from "~/components/loaders/pageLoader";
import MaintenancePage from "~/components/maintenancePage/maintenancePage";
import { CurrentNavProvider } from "~/context";
import { I18nProvider } from "~/i18n";
import { checkServerReachability } from "~/serverReachability";

const queryClient = new QueryClient();

export default function Providers({ children }: { children: React.ReactNode }) {
  const [serverState, setServerState] = useState<"initial" | "reachable" | "unreachable" | "retrying">("initial");
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let mounted = true;
    let intervalId: number | undefined;
    let currentController: AbortController | null = null;

    const runCheck = async (mode: "initial" | "background" | "retry" = "background") => {
      currentController?.abort();
      currentController = new AbortController();

      if (mode === "retry") {
        setServerState("retrying");
      }

      const reachable = await checkServerReachability(currentController.signal);

      if (mounted) {
        setServerState(reachable ? "reachable" : "unreachable");
      }
    };

    void runCheck("initial");
    intervalId = window.setInterval(() => {
      void runCheck("background");
    }, 30000);

    const handleOnline = () => {
      void runCheck("background");
    };

    window.addEventListener("online", handleOnline);

    return () => {
      mounted = false;
      currentController?.abort();
      window.removeEventListener("online", handleOnline);
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [retryNonce]);

  if (serverState === "initial") {
    return null;
  }

  if (serverState === "unreachable" || serverState === "retrying") {
    return (
      <MaintenancePage
        isChecking={serverState === "retrying"}
        onRetry={() => setRetryNonce((current) => current + 1)}
      />
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <PageLoader />
      <I18nProvider>
        <CurrentNavProvider>{children}</CurrentNavProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
