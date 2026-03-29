import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { useEffect, useState } from "react";

import type { Route } from "./+types/root";
import "./app.css";
import { CurrentNavProvider } from "./context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Header from "./components/header/header";
import Footer from "./components/footer/footer";
import PageLoader from "./components/loaders/pageLoader";
import { I18nProvider, translate } from "./i18n";
import MaintenancePage from "./components/maintenancePage/maintenancePage";
import { checkServerReachability } from "./serverReachability";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Gabarito:wght@400..900&family=Solitreo&display=swap",
  },
];

const queryClient = new QueryClient();

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <Meta />
        <Links />
        <script src="https://accounts.google.com/gsi/client" async defer/>
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <PageLoader/>
          <I18nProvider>
            <CurrentNavProvider>
              {children}
            </CurrentNavProvider>
          </I18nProvider>
        </QueryClientProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
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

  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let details = translate("errorUnexpected");
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    details =
      error.status === 404
        ? translate("errorNotFound")
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <>
      <Header/>
      <main className="p-16 max-[500px]:p-5 max-[500px]:pb-15 pt-37.5 container mx-auto">
        <h1 className="text-(--accentBlue) font-bold text-3xl mt-5">{translate("errorSorry")}</h1>
        <p className="text-lg mt-1">{details}</p>
        {stack && (
          <pre className="w-full p-4 overflow-x-auto">
            <code>{stack}</code>
          </pre>
        )}
        <Link to="/" className="button mt-4 block w-fit bg-(--accentOrange) px-5 py-3 rounded-full font-bold text-white">{translate("goToHomepage")}</Link>
      </main>
      <Footer/>
    </>
  );
}
