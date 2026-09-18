// Decode small, evenly spaced previews without seeking the visible player.
export async function createVideoThumbnails(file: File, duration: number, signal: AbortSignal, onFrame: (image: string) => void) {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 108;
  const context = canvas.getContext("2d");
  if (!context) { URL.revokeObjectURL(url); return; }
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const waitFor = (eventName: "loadedmetadata" | "seeked", action: () => void) => new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener(eventName, done);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Video preview unavailable")); };
    const aborted = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const timeout = setTimeout(failed, 15000);
    video.addEventListener(eventName, done, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    try { action(); } catch { failed(); }
  });

  try {
    await waitFor("loadedmetadata", () => { video.src = url; video.load(); });
    for (let index = 0; index < 12; index++) {
      signal.throwIfAborted();
      // Sample the center of each segment; avoid seeking exactly to the end.
      await waitFor("seeked", () => { video.currentTime = duration * (index + .5) / 12; });
      signal.throwIfAborted();
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      onFrame(canvas.toDataURL("image/jpeg", .75));
    }
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
