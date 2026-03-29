import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("video/:videoId", "routes/play.tsx"),
    route("account", "routes/account.tsx"),
    route("login", "routes/login.tsx"),
    route("forgot-password", "routes/forgotPassword.tsx"),
    route("library", "routes/library.tsx"),
    route("register", "routes/register.tsx"),
    route("search/:searchValue?", "routes/search.tsx"),
    route("events", "routes/events.tsx"),
    route("termsOfUse", "routes/termsOfUse.tsx"),
    route("privacyPolicy", "routes/privacyPolicy.tsx"),
    route("videos/:type", "routes/videos.tsx"),
    route("playlist/:id", "routes/playlist.tsx"),
    route("upload", "routes/upload.tsx"),
    route("edit", "routes/editVideo.tsx"),
    route("edit-playlist", "routes/editPlaylist.tsx"),
    route("my-videos", "routes/myVideos.tsx"),
    route("analytics", "routes/analytics.tsx"),
    route("my-playlists", "routes/myPlaylists.tsx"),
    route("uems-reading-list", "routes/uems.tsx"),
    route("google-callback", "routes/googleCallback.tsx")
] satisfies RouteConfig;
