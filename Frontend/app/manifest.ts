import type { MetadataRoute } from "next";
import { themeColor } from "./theme/serverColors";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OptiFlowz Video Platform",
    short_name: "OptiFlowz",
    id: "/",
    scope: "/",
    description: "Discover, organize, and watch professional video content on OptiFlowz.",
    start_url: "/",
    display: "standalone",
    background_color: themeColor("--background1"),
    theme_color: themeColor("--accentBlue2"),
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
