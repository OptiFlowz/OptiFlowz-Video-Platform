export interface VideoMedia {
  thumbnail_url?: string | null;
  mux_thumbnail_url?: string | null;
  preview_url?: string | null;
  media_expires_at?: string | number | null;
}

// Server URLs may be signed: preserve their path and query string exactly.
export function getVideoThumbnail(video?: VideoMedia | null): string {
  return video?.thumbnail_url || video?.mux_thumbnail_url || "";
}
