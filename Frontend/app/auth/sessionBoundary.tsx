"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getToken, subscribeToSession, isRedirectingToLogin } from "./session";

import Loader from "~/components/loaders/loader";

function SessionQueries({ children }: { children: React.ReactNode }) {
  // A fresh cache and component tree for each session, including legacy query keys.
  const [client] = useState(() => new QueryClient());
  useEffect(() => () => {
    void client.cancelQueries();
    client.clear();
  }, [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export default function SessionBoundary({ children }: { children: React.ReactNode }) {
  const redirecting = useSyncExternalStore(subscribeToSession, isRedirectingToLogin, () => false);
  const token = useSyncExternalStore(subscribeToSession, getToken, () => null);
  // The server/first hydration snapshot is anonymous. Public content can render
  // immediately; a stored session receives its own fresh cache after hydration.
  if (redirecting) return <Loader />;
  return <SessionQueries key={token ?? "anonymous"}>{children}</SessionQueries>;
}
