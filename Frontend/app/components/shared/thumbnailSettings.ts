export interface ThumbnailSettings {
  time: number;
  width: number;
  height: number;
  fit_mode: "preserve";
}

export function createThumbnailSettings(time: number): ThumbnailSettings {
  return {
    time: Math.max(0, Number(time.toFixed(2))),
    width: 1280,
    height: 720,
    fit_mode: "preserve",
  };
}
