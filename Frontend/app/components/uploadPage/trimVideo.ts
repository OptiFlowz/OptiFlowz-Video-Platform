import type { Conversion as MediaConversion } from "mediabunny";

// Loaded only when a user trims a local file (or its duration needs parsing).
export async function readLocalVideoDuration(file: File, signal: AbortSignal) {
  const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const duration = await input.computeDuration();
    signal.throwIfAborted();
    return duration;
  } finally {
    signal.removeEventListener("abort", abort);
    input.dispose();
  }
}

export async function trimVideoFile(
  file: File, start: number, end: number, signal: AbortSignal, onProgress: (progress: number) => void,
): Promise<File> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error("Invalid trim range");
  const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, Conversion, Quality } = await import("mediabunny");
  signal.throwIfAborted();
  // Prefer the source container, but try the other container if the browser has
  // no encoder for an original codec. Never silently drop an audio/video track.
  const formats = file.type.includes("webm") || /\.webm$/i.test(file.name)
    ? [new WebMOutputFormat(), new Mp4OutputFormat()]
    : [new Mp4OutputFormat(), new WebMOutputFormat()];
  for (const format of formats) {
    signal.throwIfAborted();
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const target = new BufferTarget();
    const output = new Output({ format, target });
    let conversion: MediaConversion | undefined;
    const abort = () => { if (conversion) void conversion.cancel().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (!await input.getPrimaryVideoTrack()) throw new Error("No video track");
      signal.throwIfAborted();
      conversion = await Conversion.init({
        input, output, trim: { start, end }, copy: false,
        // Retain source resolution and frame rate. Re-encode at precise trim
        // boundaries, rather than copying extra frames outside the selection.
        video: { quality: new Quality("very-high") },
        audio: { quality: new Quality("high") },
        showWarnings: false,
      });
      signal.throwIfAborted();
      if (!conversion.isValid || conversion.discardedTracks.some(({ track }) => track.type === "video" || track.type === "audio")) {
        await conversion.cancel();
        continue;
      }
      conversion.onProgress = (value) => { if (!signal.aborted) onProgress(Math.min(99, value * 100)); };
      await conversion.execute();
      signal.throwIfAborted();
      if (!target.buffer?.byteLength) throw new Error("Empty trimmed video");
      const webm = format instanceof WebMOutputFormat;
      const name = file.name.replace(/\.[^.]+$/, "").replace(/-trimmed$/, "");
      return new File([target.buffer], `${name}-trimmed.${webm ? "webm" : "mp4"}`, { type: webm ? "video/webm" : "video/mp4" });
    } finally {
      signal.removeEventListener("abort", abort);
      await conversion?.cancel().catch(() => {});
      await output.cancel().catch(() => {});
      input.dispose();
    }
  }
  throw new Error("No supported encoder for all tracks");
}
