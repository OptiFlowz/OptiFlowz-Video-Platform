import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OptiFlowz Video Platform",
    short_name: "OptiFlowz",
    description: "Discover, organize, and watch professional video content on OptiFlowz.",
    start_url: "/",
    display: "standalone",
    background_color: "#05080d",
    theme_color: "#087ff5",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
