"use client";

import NextLink from "next/link";
import { useParams as useNextParams, usePathname, useRouter, useSearchParams as useNextSearchParams } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import { forwardRef, useEffect, useMemo, useState } from "react";

type LinkProps = Omit<ComponentProps<"a">, "href"> & {
  to: string;
  prefetch?: boolean;
  preventScrollReset?: boolean;
  replace?: boolean;
};

type NavLinkProps = Omit<LinkProps, "className" | "children"> & {
  children?: ReactNode | ((props: { isActive: boolean }) => ReactNode);
  className?: string | ((props: { isActive: boolean }) => string);
  end?: boolean;
};

function isExternalHref(href: string) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, children, prefetch, preventScrollReset, replace, ...props },
  ref,
) {
  if (isExternalHref(to)) {
    return (
      <a ref={ref} href={to} {...props}>
        {children}
      </a>
    );
  }

  return (
    <NextLink ref={ref} href={to} prefetch={prefetch} replace={replace} {...props}>
      {children}
    </NextLink>
  );
});

export function NavLink({ to, className, children, end, ...props }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  const resolvedClassName = typeof className === "function" ? className({ isActive }) : className;
  const resolvedChildren = typeof children === "function" ? children({ isActive }) : children;

  return (
    <Link to={to} className={resolvedClassName} {...props}>
      {resolvedChildren}
    </Link>
  );
}

export function useNavigate() {
  const router = useRouter();

  return (
    to:
      | string
      | number
      | {
          pathname?: string;
          search?: string;
          hash?: string;
        },
    options?: { replace?: boolean; preventScrollReset?: boolean },
  ) => {
    if (typeof to === "number") {
      if (to < 0) {
        router.back();
      }
      return;
    }

    const href =
      typeof to === "string"
        ? to
        : `${to.pathname ?? ""}${to.search ?? ""}${to.hash ?? ""}`;

    if (options?.replace) {
      router.replace(href);
      return;
    }

    router.push(href);
  };
}

export function useLocation() {
  const pathname = usePathname();
  const searchParams = useNextSearchParams();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const updateHash = () => setHash(window.location.hash);

    updateHash();
    window.addEventListener("hashchange", updateHash);

    return () => window.removeEventListener("hashchange", updateHash);
  }, [pathname, searchParams]);

  const search = searchParams.toString();

  return useMemo(
    () => ({
      pathname,
      search: search ? `?${search}` : "",
      hash,
      key: `${pathname}${search}${hash}`,
      state: null,
    }),
    [hash, pathname, search],
  );
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>() {
  const params = useNextParams<Record<string, string | string[] | undefined>>();

  return useMemo(() => {
    const normalized: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        normalized[key] = value.join("/");
      } else {
        normalized[key] = value;
      }
    }

    return normalized as T;
  }, [params]);
}

export function useSearchParams() {
  return [useNextSearchParams()] as const;
}

export function useNavigation() {
  return { state: "idle" as "idle" | "loading" | "submitting" };
}

export function Outlet() {
  return null;
}

export function Links() {
  return null;
}

export function Meta() {
  return null;
}

export function Scripts() {
  return null;
}

export function ScrollRestoration() {
  return null;
}

export function isRouteErrorResponse(_error: unknown) {
  return false;
}
