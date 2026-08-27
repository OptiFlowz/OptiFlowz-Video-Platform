import type { Metadata } from "next";
import { DEFAULT_META_DESCRIPTION, DEFAULT_PAGE_TITLE } from "./changeables";

export const SITE_NAME = "OptiFlowz";
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  process.env.VITE_SITE_URL?.replace(/\/$/, "") ||
  "https://videoplatform.optiflowz.com";

export const DEFAULT_DESCRIPTION =
  "Discover, organize, and watch professional video content, playlists, and learning resources on OptiFlowz.";

type MetadataOptions = {
  title: string;
  description?: string | null;
  path?: string;
  image?: string | null;
  noIndex?: boolean;
  follow?: boolean;
  type?: "website" | "article";
  keywords?: string[];
};

const toAbsoluteUrl = (value: string) => {
  try {
    return new URL(value, SITE_URL).toString();
  } catch {
    return `${SITE_URL}/opengraph-image`;
  }
};

export const cleanMetaDescription = (
  value: string | null | undefined,
  fallback = DEFAULT_DESCRIPTION,
) => {
  const cleaned = value
    ?.replace(/<[^>]*>/g, " ")
    .replace(/[`*_~#[\]()>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return fallback;
  return cleaned.length > 160 ? `${cleaned.slice(0, 157).trimEnd()}…` : cleaned;
};

export function createPageMetadata({
  title,
  description,
  path = "/",
  image,
  noIndex = false,
  follow = !noIndex,
  type = "website",
  keywords,
}: MetadataOptions): Metadata {
  const resolvedDescription = cleanMetaDescription(description);
  const canonical = toAbsoluteUrl(path);
  const socialImage = toAbsoluteUrl(image || "/opengraph-image");

  return {
    title,
    description: resolvedDescription,
    keywords,
    alternates: { canonical },
    robots: noIndex
      ? { index: false, follow, noarchive: true }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
        },
    openGraph: {
      type,
      title,
      description: resolvedDescription,
      url: canonical,
      siteName: SITE_NAME,
      locale: "en_US",
      images: image
        ? [{ url: socialImage, alt: `${title} — ${SITE_NAME}` }]
        : [{ url: socialImage, width: 1200, height: 630, alt: `${title} — ${SITE_NAME}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: resolvedDescription,
      images: [socialImage],
    },
  };
}

export const defaultMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: DEFAULT_PAGE_TITLE,
  title: {
    default: DEFAULT_PAGE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  keywords: [
    "OptiFlowz",
    "video platform",
    "professional videos",
    "video library",
    "learning playlists",
  ],
  authors: [{ name: SITE_NAME, url: "https://optiflowz.com" }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "technology",
  referrer: "origin-when-cross-origin",
  formatDetection: { email: false, address: false, telephone: false },
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.ico", shortcut: "/favicon.ico", apple: "/favicon.ico" },
  manifest: "/manifest.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    title: DEFAULT_PAGE_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    locale: "en_US",
    images: [
      { url: "/opengraph-image", width: 1200, height: 630, alt: DEFAULT_PAGE_TITLE },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_PAGE_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

export const loginMetadata = createPageMetadata({
  title: "Log in",
  description: "Log in to your OptiFlowz account.",
  path: "/login",
  noIndex: true,
});

export const registerMetadata = createPageMetadata({
  title: "Create an account",
  description: "Create your OptiFlowz account.",
  path: "/register",
  noIndex: true,
});

export const forgotPasswordMetadata = createPageMetadata({
  title: "Reset password",
  description: "Reset the password for your OptiFlowz account.",
  path: "/forgot-password",
  noIndex: true,
});

export const libraryMetadata = createPageMetadata({
  title: "Video library",
  description: DEFAULT_DESCRIPTION,
  path: "/",
});

export const analyticsMetadata = createPageMetadata({
  title: "Video analytics",
  description: "View video performance, watch time, engagement, and audience insights.",
  path: "/analytics",
  noIndex: true,
});

export const legacyDefaultDescription = DEFAULT_META_DESCRIPTION;
