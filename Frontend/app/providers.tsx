"use client";

import { AuthorizationProvider } from "~/authorization/authorization";

import { useEffect, useState } from "react";
import PageLoader from "~/components/loaders/pageLoader";
import { CurrentNavProvider } from "~/context";
import { I18nProvider, useI18n } from "~/i18n";
import { checkServerReachability } from "~/serverReachability";
import PersistentVideoProvider from "~/components/persistentVideo/persistentVideoProvider";
import { PrivacyPreferencesProvider } from "~/privacy/privacyPreferences";
import SessionBoundary from "~/auth/sessionBoundary";

import { UploadSessionProvider } from "~/components/uploadPage/uploadSession";

function ConnectionStatus() {
  const { t } = useI18n();
  const [serverState, setServerState] = useState<"initial" | "reachable" | "unreachable" | "retrying">("initial");
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let mounted = true;
    let intervalId: number | undefined;
    let currentController: AbortController | null = null;

    const runCheck = async (mode: "initial" | "background" | "retry" = "background") => {
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;

      if (mode === "retry") {
        setServerState("retrying");
      }

      const reachable = await checkServerReachability(controller.signal);

      if (mounted && !controller.signal.aborted) {
        setServerState(reachable ? "reachable" : "unreachable");
      }
    };

    void runCheck(retryNonce ? "retry" : "initial");
    intervalId = window.setInterval(() => {
      void runCheck("background");
    }, 30000);

    const handleOnline = () => {
      void runCheck("background");
    };
    const handleOffline = () => {
      currentController?.abort();
      setServerState("unreachable");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      mounted = false;
      currentController?.abort();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [retryNonce]);

  if (serverState === "initial" || serverState === "reachable") return null;
  return <div className="connectionStatus" role="status" aria-live="polite">
    <span>{t("connectionInterrupted")}</span>
    <button type="button" disabled={serverState === "retrying"} onClick={() => setRetryNonce(value => value + 1)}>{t(serverState === "retrying" ? "connectionChecking" : "usersRetry")}</button>
  </div>;
}

export default function Providers({ children }: { children: React.ReactNode }) {

  useEffect(() => {
    const closeOptiflowzChat = () => {
      const chat = document.getElementById("optiflowz-chat");
      const openButton = document.getElementById("optiflowz-chat-open");

      if (!chat?.classList.contains("chat-open") || !(openButton instanceof HTMLElement)) {
        return;
      }

      openButton.click();
    };

    const handleChatLinkClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const link = target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") {
        return;
      }

      const chatRoot = document.getElementById("optiflowz-chat");
      if (!chatRoot?.contains(link)) {
        return;
      }

      closeOptiflowzChat();
    };

    document.addEventListener("click", handleChatLinkClick, true);

    return () => {
      document.removeEventListener("click", handleChatLinkClick, true);
    };
  }, []);

  return (
    <SessionBoundary>
      <PageLoader />
      <I18nProvider>
        <ConnectionStatus />
        <AuthorizationProvider>
        <PrivacyPreferencesProvider>
          <CurrentNavProvider>
            <PersistentVideoProvider><UploadSessionProvider>{children}</UploadSessionProvider></PersistentVideoProvider>
          </CurrentNavProvider>
        </PrivacyPreferencesProvider>
        </AuthorizationProvider>
      </I18nProvider>
    </SessionBoundary>
  );
}
