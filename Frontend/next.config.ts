import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.VITE_FIRST ?? "",
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VITE_SITE_URL ?? "",
    NEXT_PUBLIC_GOOGLE_CLIENT_ID:
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.VITE_CLIENT_ID ?? "",
  },
  images: {
    disableStaticImages: true,
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.(png|jpe?g|gif|webp|svg)$/i,
      type: "asset/resource",
    });

    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "react-router": path.resolve(__dirname, "next/react-router.tsx"),
    };

    return config;
  },
};

export default nextConfig;
