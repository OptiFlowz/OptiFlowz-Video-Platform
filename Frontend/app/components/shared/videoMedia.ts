export interface VideoMedia {
  thumbnail_url?: string | null;
  mux_thumbnail_url?: string | null;
  preview_url?: string | null;
  media_expires_at?: string | number | null;
}

// Server URLs may be signed: preserve their path and query string exactly.
export function getVideoThumbnail(video?: VideoMedia | null): string {
  // Older records can contain an unsigned or expired Mux image URL in
  // thumbnail_url. Use the server's current Mux URL, while keeping uploaded
  // custom thumbnails ahead of generated frames.
  if (video?.thumbnail_url && video.mux_thumbnail_url) {
    try {
      if (new URL(video.thumbnail_url).hostname === "image.mux.com") {
        return video.mux_thumbnail_url;
      }
    } catch {
      // Relative/local custom images should retain their existing priority.
    }
  }
  return video?.thumbnail_url || video?.mux_thumbnail_url || "";
}
