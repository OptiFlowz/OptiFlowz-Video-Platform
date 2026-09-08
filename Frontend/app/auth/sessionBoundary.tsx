"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getToken, subscribeToSession } from "./session";

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
  const token = useSyncExternalStore(subscribeToSession, getToken, () => null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Storage is browser-owned. Mount consumers only after the initial snapshot.
  if (!mounted) return null;
  return <SessionQueries key={token ?? "anonymous"}>{children}</SessionQueries>;
}
