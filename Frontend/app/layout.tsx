import "flag-icons/css/flag-icons.min.css";
import "./app.css";
import type { Metadata } from "next";
import Providers from "./providers";
import { defaultMetadata } from "./metadata";
import { FAVICON } from "./changeables";
import { Gabarito, Solitreo } from "next/font/google";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${gabarito.variable} ${solitreo.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
        <link rel="icon" type="image/x-icon" href={FAVICON} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
