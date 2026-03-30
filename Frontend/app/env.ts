export const env = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
  isDev: process.env.NODE_ENV !== "production",
};
