let mediaThemePromise: Promise<unknown> | null = null;

export function loadMediaTheme() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (!mediaThemePromise) {
    // @ts-ignore local vendored JS module has no type declarations
    mediaThemePromise = import("./optiflowzTheme/dist/media-theme.js");
  }

  return mediaThemePromise;
}
