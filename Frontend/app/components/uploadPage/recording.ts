import { fixWebmDuration } from "@fix-webm-duration/fix";

export type RecordingMode = "screen" | "camera" | "combined";
export type CameraCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type RecordingQuality = "original" | "2160" | "1440" | "1080" | "720";
export const RECORDING_QUALITIES: RecordingQuality[] = ["original", "2160", "1440", "1080", "720"];
const qualityProfiles = {
  original: { width: 7680, height: 4320, frameRate: 60 },
  "2160": { width: 3840, height: 2160, frameRate: 60 },
  "1440": { width: 2560, height: 1440, frameRate: 60 },
  "1080": { width: 1920, height: 1080, frameRate: 60 },
  "720": { width: 1280, height: 720, frameRate: 30 },
} as const;

function videoConstraints(quality: RecordingQuality): MediaTrackConstraints {
  const profile = qualityProfiles[quality];
  return {
    width: { ideal: profile.width, ...(quality === "original" ? {} : { max: profile.width }) },
    height: { ideal: profile.height, ...(quality === "original" ? {} : { max: profile.height }) },
    frameRate: { ideal: profile.frameRate, max: profile.frameRate },
  };
}

export type RecordingDraft = {
  video: Blob; camera?: Blob; duration: number; quality: RecordingQuality; frameRate: number;
};
export type CaptureSources = {
  primary: MediaStream;
  camera?: MediaStream;
  hasScreenAudio: boolean;
  quality: RecordingQuality;
  frameRate: number;
  dispose: () => void;
};

const abortError = () => new DOMException("Cancelled", "AbortError");
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw abortError(); };

function recorderFor(stream: MediaStream, frameRate: number) {
  const mimeType = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
    .find((type) => MediaRecorder.isTypeSupported(type));
  const settings = stream.getVideoTracks()[0].getSettings();
  const pixels = (settings.width || 1920) * (settings.height || 1080);
  // Scale bitrate with the actual pixels and frame rate, including the final
  // composition. A flat 6 Mbps budget loses fine screen text at high resolution.
  const videoBitsPerSecond = Math.round(Math.min(120_000_000, Math.max(8_000_000,
    pixels * Math.min(settings.frameRate || frameRate, frameRate) * 0.22)));
  return new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}), videoBitsPerSecond, audioBitsPerSecond: 192_000,
  });
}

export async function captureSources(
  mode: RecordingMode,
  microphone: boolean,
  screenAudio: boolean,
  quality: RecordingQuality,
  signal: AbortSignal,
): Promise<CaptureSources> {
  const streams: MediaStream[] = [];
  let audioContext: AudioContext | undefined;
  const dispose = () => {
    streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    if (audioContext && audioContext.state !== "closed") void audioContext.close();
    signal.removeEventListener("abort", dispose);
  };
  signal.addEventListener("abort", dispose, { once: true });
  const remember = (stream: MediaStream) => {
    streams.push(stream);
    if (signal.aborted) { dispose(); throw abortError(); }
    return stream;
  };
  try {
    checkAbort(signal);
    // Unlock audio while the source-selection click still has user activation.
    // Do not await it before opening the display picker.
    if (microphone || (mode !== "camera" && screenAudio)) audioContext = new AudioContext();
    const audioReady = audioContext?.resume();
    // Handle rejection immediately even while the browser's source picker is open.
    const audioState = audioReady?.then(() => null, (error: unknown) => error);
    // Invoke the display picker directly from the click, before any other await.
    const screen = mode !== "camera" ? remember(await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints(quality), audio: screenAudio,
    })) : undefined;
    const camera = mode !== "screen" ? remember(await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(quality),
      audio: microphone ? { echoCancellation: true, noiseSuppression: true } : false,
    })) : undefined;
    const mic = mode === "screen" && microphone ? remember(await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })) : undefined;
    const audioTracks = [screen, camera, mic].flatMap((stream) => stream?.getAudioTracks() ?? []);
    const primary = new MediaStream((screen ?? camera)!.getVideoTracks());
    if (audioTracks.length) {
      const audioError = await audioState;
      if (audioError) throw audioError;
      checkAbort(signal);
      const destination = audioContext!.createMediaStreamDestination();
      audioTracks.forEach((track) => {
        audioContext!.createMediaStreamSource(new MediaStream([track])).connect(destination);
      });
      destination.stream.getAudioTracks().forEach((track) => primary.addTrack(track));
    }
    remember(primary);
    if (!primary.getVideoTracks().some((track) => track.readyState === "live")) throw new Error("Source ended");
    return {
      primary, camera: mode === "combined" ? new MediaStream(camera!.getVideoTracks()) : undefined,
      hasScreenAudio: !!screen?.getAudioTracks().length, dispose, quality,
      frameRate: Math.min(primary.getVideoTracks()[0].getSettings().frameRate || qualityProfiles[quality].frameRate,
        qualityProfiles[quality].frameRate),
    };
  } catch (error) { dispose(); throw error; }
}

async function finalBlob(chunks: Blob[], mimeType: string, duration: number) {
  const blob = new Blob(chunks, { type: mimeType || chunks[0]?.type || "video/webm" });
  if (!blob.size) throw new Error("Empty recording");
  return blob.type.includes("webm") ? fixWebmDuration(blob, duration, { logger: false }) : blob;
}

export function recordSources(sources: CaptureSources, onEnded: () => void, onError: () => void) {
  const primary = recorderFor(sources.primary, sources.frameRate);
  const camera = sources.camera ? recorderFor(sources.camera, sources.frameRate) : undefined;
  const recorders = [primary, ...(camera ? [camera] : [])];
  const chunks = recorders.map(() => [] as Blob[]);
  let started = 0;
  let duration = 0;
  let stopped = false;
  let failed = false;
  const finished = recorders.map((recorder, index) => new Promise<void>((resolve) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks[index].push(event.data); };
    recorder.onstop = () => resolve();
    recorder.onerror = () => { failed = true; onError(); resolve(); };
  }));
  const tracks = [sources.primary, sources.camera].flatMap((stream) => stream?.getVideoTracks() ?? []);
  tracks.forEach((track) => track.addEventListener("ended", onEnded));
  const stopRecorders = () => {
    if (stopped) return;
    stopped = true;
    duration = performance.now() - started;
    tracks.forEach((track) => track.removeEventListener("ended", onEnded));
    recorders.forEach((recorder) => { if (recorder.state !== "inactive") recorder.stop(); });
    sources.dispose();
  };
  try {
    started = performance.now();
    recorders.forEach((recorder) => recorder.start(1000));
  } catch (error) { stopRecorders(); throw error; }
  return {
    cancel: stopRecorders,
    stop: async (): Promise<RecordingDraft> => {
      stopRecorders();
      await Promise.all(finished);
      if (failed) throw new Error("Recording failed");
      const blobs = await Promise.all(recorders.map((recorder, index) => finalBlob(chunks[index], recorder.mimeType, duration)));
      return { video: blobs[0], camera: blobs[1], duration: duration / 1000, quality: sources.quality, frameRate: sources.frameRate };
    },
  };
}

export function recordingFile(blob: Blob) {
  return new File([blob], `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${blob.type.includes("mp4") ? "mp4" : "webm"}`, { type: blob.type });
}

// Keep the original camera track separate until the user chooses the final corner.
// Encoding runs at playback speed; hidden tabs pause both the encoder and videos.
export async function composeRecording(
  draft: RecordingDraft,
  corner: CameraCorner,
  background: string,
  signal: AbortSignal,
  onProgress: (value: number) => void,
): Promise<Blob> {
  const urls: string[] = [];
  const videos: HTMLVideoElement[] = [];
  let context: AudioContext | undefined;
  let output: MediaStream | undefined;
  let encoder: MediaRecorder | undefined;
  let frame = 0;
  let removeListeners = () => {};
  const load = (blob: Blob) => new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement("video");
    videos.push(video);
    video.playsInline = true;
    video.preload = "auto";
    video.muted = true;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const abort = () => { cleanup(); reject(abortError()); };
    const cleanup = () => {
      video.onloadeddata = null;
      video.onerror = null;
      signal.removeEventListener("abort", abort);
    };
    video.onloadeddata = () => { cleanup(); resolve(video); };
    video.onerror = () => { cleanup(); reject(new Error("Cannot decode recording")); };
    signal.addEventListener("abort", abort, { once: true });
    video.src = url;
    video.load();
  });
  try {
    checkAbort(signal);
    // Resume audio while still in the originating user gesture.
    context = new AudioContext();
    await context.resume();
    checkAbort(signal);
    const [screen, camera] = await Promise.all([load(draft.video), load(draft.camera!)]);
    checkAbort(signal);
    const canvas = document.createElement("canvas");
    const profile = qualityProfiles[draft.quality];
    // Original keeps the captured resolution, including Retina/4K screens.
    // Never upscale a lower-resolution source just to match a quality label.
    const scale = draft.quality === "original" ? 1
      : Math.min(1, profile.width / screen.videoWidth, profile.height / screen.videoHeight);
    canvas.width = Math.max(2, Math.floor(screen.videoWidth * scale / 2) * 2);
    canvas.height = Math.max(2, Math.floor(screen.videoHeight * scale / 2) * 2);
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new Error("Canvas unavailable");
    const draw = () => {
      drawing.fillStyle = background;
      drawing.fillRect(0, 0, canvas.width, canvas.height);
      drawing.drawImage(screen, 0, 0, canvas.width, canvas.height);
      const width = canvas.width * 0.24;
      const height = width * 9 / 16;
      const margin = canvas.width * 0.02;
      const x = corner.endsWith("right") ? canvas.width - width - margin : margin;
      const y = corner.startsWith("bottom") ? canvas.height - height - margin : margin;
      // Center-crop the camera to the same 16:9 frame as the review overlay.
      const cropWidth = Math.min(camera.videoWidth, camera.videoHeight * 16 / 9);
      const cropHeight = cropWidth * 9 / 16;
      drawing.drawImage(camera, (camera.videoWidth - cropWidth) / 2, (camera.videoHeight - cropHeight) / 2,
        cropWidth, cropHeight, x, y, width, height);
    };
    draw();
    output = canvas.captureStream(draft.frameRate);
    const destination = context.createMediaStreamDestination();
    context.createMediaElementSource(screen).connect(destination);
    destination.stream.getAudioTracks().forEach((track) => output!.addTrack(track));
    // Audio is routed only to the recorder, never to the local speakers.
    screen.muted = false;
    encoder = recorderFor(output, draft.frameRate);
    const chunks: Blob[] = [];
    const recorder = encoder;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
      const abort = () => fail(abortError());
      const tick = () => {
        if (settled) return;
        try {
          if (Math.abs(camera.currentTime - screen.currentTime) > 0.15 && !camera.seeking) {
            camera.currentTime = Math.min(screen.currentTime, camera.duration);
          }
          draw();
          onProgress(Math.min(99, screen.currentTime / draft.duration * 100));
        } catch (error) { fail(error); return; }
        frame = requestAnimationFrame(tick);
      };
      const play = () => {
        if (settled) return;
        void Promise.all([screen.play(), camera.play()]).catch(fail);
      };
      const visibility = () => {
        if (settled || recorder.state === "inactive") return;
        if (document.hidden) {
          screen.pause(); camera.pause();
          if (recorder.state === "recording") recorder.pause();
        } else {
          if (recorder.state === "paused") recorder.resume();
          play();
        }
      };
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => fail(new Error("Encoding failed"));
      recorder.onstop = () => { if (!settled) { settled = true; resolve(); } };
      screen.onended = () => { if (recorder.state !== "inactive") recorder.stop(); };
      screen.onerror = camera.onerror = () => fail(new Error("Playback failed"));
      signal.addEventListener("abort", abort, { once: true });
      document.addEventListener("visibilitychange", visibility);
      removeListeners = () => {
        signal.removeEventListener("abort", abort);
        document.removeEventListener("visibilitychange", visibility);
      };
      recorder.start(1000);
      tick();
      if (document.hidden) visibility(); else play();
    });
    checkAbort(signal);
    const blob = await finalBlob(chunks, recorder.mimeType, draft.duration * 1000);
    checkAbort(signal);
    onProgress(100);
    return blob;
  } finally {
    removeListeners();
    cancelAnimationFrame(frame);
    if (encoder && encoder.state !== "inactive") encoder.stop();
    videos.forEach((video) => { video.pause(); video.removeAttribute("src"); video.load(); });
    output?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed") void context.close();
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}
