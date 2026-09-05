import "flag-icons/css/flag-icons.min.css";
import "./app.css";
import type { Metadata, Viewport } from "next";
import Providers from "./providers";
import { defaultMetadata } from "./metadata";
import { Gabarito, Solitreo } from "next/font/google";
import { SITE_URL } from "./metadata";

const gabarito = Gabarito({
  subsets: ["latin"],
  variable: "--font-gabarito",
  display: "swap",
});

const solitreo = Solitreo({
  subsets: ["latin"],
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
  themeColor: "#05080d",
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
    <html lang="en" dir="ltr" className={`${gabarito.variable} ${solitreo.variable}`}>
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
