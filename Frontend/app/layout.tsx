import Script from "next/script";
import "./app.css";
import type { Metadata } from "next";
import Providers from "./providers";
import { defaultMetadata } from "./metadata";

export const metadata: Metadata = defaultMetadata;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Gabarito:wght@400..900&family=Solitreo&display=swap"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
        <Script
          src="https://ai-chatbot-platform.fly.dev/widget/index.js"
          strategy="afterInteractive"
          data-agent-name="OptiFlowz AI"
          data-chat-header-title-font-size="1.3rem"
          data-agent-description="Your friendly AI Agent"
          data-chat-header-description-font-size="0.72rem"
          data-agent-icon="https://cdn.jsdelivr.net/gh/OptiFlowz/OptiFlowz-Main-Chat/aiAgentImg.png"
          data-privacy-url="https://optiflowz.com/privacy-policy"
          data-questions={`["I'd like to report a problem","Tell me more about OptiFlowz Video Platform"]`}
          data-chat-desktop-width="410px"
          data-chat-desktop-height="550px"
        />
      </body>
    </html>
  );
}
