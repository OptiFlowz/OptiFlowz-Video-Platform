/** Ask the mounted playlist controller to advance once its next page is ready. */
export const PLAYLIST_ADVANCE_EVENT = "optiflowz:playlist-advance";

export function requestPlaylistAdvance(videoId: string) {
  window.dispatchEvent(new CustomEvent(PLAYLIST_ADVANCE_EVENT, { detail: { videoId }, cancelable: true }));
}
