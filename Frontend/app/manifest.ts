import type { MetadataRoute } from "next";
import { DEFAULT_THEME } from "./theme";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OptiFlowz Video Platform",
    short_name: "OptiFlowz",
    description: "Discover, organize, and watch professional video content on OptiFlowz.",
    start_url: "/",
    display: "standalone",
    background_color: DEFAULT_THEME.metadata.manifestBackgroundColor,
    theme_color: DEFAULT_THEME.metadata.manifestThemeColor,
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
