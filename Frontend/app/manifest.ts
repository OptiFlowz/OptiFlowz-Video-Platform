import type { MetadataRoute } from "next";
import { themeColor } from "./theme/serverColors";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OptiFlowz Video Platform",
    short_name: "OptiFlowz",
    description: "Discover, organize, and watch professional video content on OptiFlowz.",
    start_url: "/",
    display: "standalone",
    background_color: themeColor("--background1"),
    theme_color: themeColor("--accentBlue2"),
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
