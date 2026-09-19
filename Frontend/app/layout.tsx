import "flag-icons/css/flag-icons.min.css";
import "./app.css";
import type { Metadata, Viewport } from "next";
import Providers from "./providers";
import { defaultMetadata } from "./metadata";
import localFont from "next/font/local";
import { SITE_URL } from "./metadata";
import { themeColor } from "./theme/serverColors";

const outfit = localFont({
  src: "./fonts/outfit/Outfit-Variable.ttf",
  weight: "100 900",
  style: "normal",
  variable: "--font-outfit",
  display: "swap",
});

const solitreo = localFont({
  src: "./fonts/solitreo/Solitreo-Regular.ttf",
  weight: "400",
  variable: "--font-solitreo",
  display: "swap",
});

export const metadata: Metadata = defaultMetadata;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: themeColor("--background1"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "OptiFlowz",
    url: "https://optiflowz.com",
    logo: `${SITE_URL}/favicon.ico`,
  };

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "OptiFlowz Video Platform",
    alternateName: "OptiFlowz",
    url: SITE_URL,
  };

  return (
    <html lang="en" dir="ltr" className={`${outfit.variable} ${solitreo.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd).replace(/</g, "\\u003c") }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd).replace(/</g, "\\u003c") }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
