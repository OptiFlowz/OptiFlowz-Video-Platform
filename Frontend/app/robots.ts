import type { MetadataRoute } from "next";
import { SITE_URL } from "./metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/video/", "/playlist/", "/channel/", "/videos/2", "/termsOfUse", "/privacyPolicy"],
        disallow: [
          "/account",
          "/analytics",
          "/channel-analytics",
          "/edit",
          "/edit-playlist",
          "/forgot-password",
          "/google-callback",
          "/login",
          "/my-playlists",
          "/my-videos",
          "/platform-analytics",
          "/platform-settings",
          "/platform-users",
          "/quiz/",
          "/quizzes",
          "/register",
          "/speakers-chairs",
          "/uems-reading-list",
          "/upload",
          "/video-analytics",
          "/videos/0",
          "/videos/1",
          "/videos/3",
          "/videos/4",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
