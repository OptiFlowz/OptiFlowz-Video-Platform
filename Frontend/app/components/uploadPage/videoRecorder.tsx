import { useEffect, useRef, useState } from "react";
import { useI18n } from "~/i18n";
import { RecordCameraSVG, RecordScreenSVG, RecordVideoSVG } from "~/constants";
import CustomSelect from "../customSelect/customSelect";
import {
  captureSources, composeRecording, recordingFile, recordSources, RECORDING_QUALITIES,
  type CameraCorner, type CaptureSources, type RecordingDraft, type RecordingMode, type RecordingQuality,
} from "./recording";
import styles from "./videoRecorder.module.css";

type Stage = "idle" | "requesting" | "ready" | "recording" | "stopping" | "review" | "exporting";
const corners: CameraCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const modes: RecordingMode[] = ["screen", "camera", "combined"];
// Same custom checkbox styling as the My videos selection controls.
const checkboxClassName = "appearance-none rounded-lg! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative shrink-0 checked:after:content-['✓'] checked:after:absolute checked:after:text-(--text1) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2";

function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) { setUrl(undefined); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function LiveVideo({ stream, className }: { stream: MediaStream; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current!;
    video.srcObject = stream;
    void video.play().catch(() => {});
    return () => { video.pause(); video.srcObject = null; };
  }, [stream]);
  return <video ref={ref} muted autoPlay playsInline className={className} />;
}

function ReviewVideo({ draft, corner }: { draft: RecordingDraft; corner: CameraCorner }) {
  const { t } = useI18n();
  const mainUrl = useBlobUrl(draft.video);
  const cameraUrl = useBlobUrl(draft.camera);
  const mainRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const [playbackError, setPlaybackError] = useState(false);
  useEffect(() => { setPlaybackError(false); }, [mainUrl, cameraUrl]);
  const sync = () => {
    const main = mainRef.current;
    const camera = cameraRef.current;
    if (!main || !camera || !camera.readyState) return;
    if (Math.abs(camera.currentTime - main.currentTime) > 0.15) camera.currentTime = main.currentTime;
    camera.playbackRate = main.playbackRate;
  };
  return <>
    <div className={styles.preview}>
      <video key={mainUrl} ref={mainRef} src={mainUrl} playsInline controls preload="auto"
        controlsList={cameraUrl ? "nofullscreen noremoteplayback" : undefined} disablePictureInPicture={!!cameraUrl}
        onPlay={() => { sync(); void cameraRef.current?.play().catch(() => { setPlaybackError(true); }); }}
        onPause={() => cameraRef.current?.pause()} onEnded={() => cameraRef.current?.pause()}
        onSeeking={sync} onSeeked={sync} onTimeUpdate={sync} onRateChange={sync}
        onError={() => setPlaybackError(true)} />
      {cameraUrl && <video key={cameraUrl} ref={cameraRef} src={cameraUrl} muted playsInline preload="auto"
        onLoadedData={sync} onError={() => setPlaybackError(true)}
        className={`${styles.camera} ${styles[corner]}`} />}
    </div>
    {playbackError && <p className={styles.error} role="alert">{t("recorderPreviewError")}</p>}
  </>;
}

export default function VideoRecorder({ onAccept, onActiveChange }: {
  onAccept: (file: File) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RecordingMode>("screen");
  const [quality, setQuality] = useState<RecordingQuality>("original");
  const [microphone, setMicrophone] = useState(true);
  const [screenAudio, setScreenAudio] = useState(false);
  const [corner, setCorner] = useState<CameraCorner>("bottom-right");
  const [stage, setStage] = useState<Stage>("idle");
  const [sources, setSources] = useState<CaptureSources>();
  const [draft, setDraft] = useState<RecordingDraft>();
  const [errorKey, setErrorKey] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [progress, setProgress] = useState(0);
  const [supported, setSupported] = useState({ camera: false, screen: false });
  const operation = useRef<AbortController | null>(null);
  const sourceRef = useRef<CaptureSources | undefined>(undefined);
  const sessionRef = useRef<ReturnType<typeof recordSources> | undefined>(undefined);
  const stopRef = useRef<() => void>(() => {});
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const release = () => {
    operation.current?.abort();
    sessionRef.current?.cancel();
    sessionRef.current = undefined;
    sourceRef.current?.dispose();
    sourceRef.current = undefined;
  };
  useEffect(() => {
    const canRecord = window.isSecureContext && typeof MediaRecorder !== "undefined";
    const camera = canRecord && !!navigator.mediaDevices?.getUserMedia;
    const screen = canRecord && !!navigator.mediaDevices?.getDisplayMedia;
    setSupported({ camera, screen });
    if (!screen && camera) setMode("camera");
    return release;
  }, []);
  useEffect(() => { onActiveChange(open); }, [open, onActiveChange]);
  useEffect(() => {
    if (stage !== "recording") return;
    const start = performance.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((performance.now() - start) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [stage]);
  useEffect(() => {
    if (!open || stage === "idle") return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [open, stage]);
  // Also handle the browser's Stop sharing button while the source preview is open.
  useEffect(() => {
    if (!sources || stage !== "ready") return;
    const ended = () => {
      if (stageRef.current !== "ready") return;
      release(); setSources(undefined); setStage("idle"); setErrorKey("recorderSourceEnded");
    };
    const tracks = [sources.primary, sources.camera].flatMap((stream) => stream?.getVideoTracks() ?? []);
    tracks.forEach((track) => track.addEventListener("ended", ended));
    return () => tracks.forEach((track) => track.removeEventListener("ended", ended));
  }, [sources, stage]);

  const reset = () => {
    release(); setSources(undefined); setDraft(undefined);
    setStage("idle"); setSeconds(0); setProgress(0); setErrorKey("");
  };
  const chooseSources = async () => {
    if (stage !== "idle") return;
    const controller = new AbortController();
    operation.current = controller;
    setErrorKey(""); setStage("requesting");
    try {
      const next = await captureSources(mode, microphone, screenAudio, quality, controller.signal);
      if (controller.signal.aborted) { next.dispose(); return; }
      sourceRef.current = next;
      setSources(next); setStage("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setStage("idle");
      setErrorKey(error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)
        ? "recorderPermissionError" : "recorderCaptureError");
    }
  };
  const stop = async () => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = undefined;
    const signal = operation.current!.signal;
    setStage("stopping");
    try {
      const next = await session.stop();
      if (signal.aborted) return;
      setSources(undefined); sourceRef.current = undefined;
      setDraft(next); setStage("review");
    } catch {
      if (signal.aborted) return;
      reset(); setErrorKey("recorderCaptureError");
    }
  };
  stopRef.current = () => { void stop(); };
  const start = () => {
    if (!sources || stage !== "ready") return;
    if ([sources.primary, sources.camera].some((stream) => stream?.getVideoTracks().some((track) => track.readyState !== "live"))) {
      reset(); setErrorKey("recorderSourceEnded"); return;
    }
    try {
      sessionRef.current = recordSources(sources, () => stopRef.current(), () => stopRef.current());
      setSeconds(0); setStage("recording");
    } catch { reset(); setErrorKey("recorderCaptureError"); }
  };
  const accept = async () => {
    if (!draft || stage !== "review") return;
    if (!draft.camera) {
      onAccept(recordingFile(draft.video));
      reset(); setOpen(false);
      return;
    }
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setErrorKey(""); setProgress(0); setStage("exporting");
    try {
      const background = getComputedStyle(document.documentElement).getPropertyValue("--playerBlack").trim()
        || getComputedStyle(document.documentElement).getPropertyValue("--background1").trim();
      const blob = await composeRecording(draft, corner, background, controller.signal, setProgress);
      if (controller.signal.aborted) return;
      onAccept(recordingFile(blob));
      reset(); setOpen(false);
    } catch {
      if (controller.signal.aborted) return;
      setStage("review"); setErrorKey("recorderExportError");
    }
  };
  const captureSettings = sources?.primary.getVideoTracks()[0]?.getSettings();
  const supportedMode = mode === "camera" ? supported.camera : supported.screen && (mode !== "combined" || supported.camera);
  const duration = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  const cornerPicker = <div className={styles.cornerPicker}>
    <span>{t("recorderCameraPosition")}</span>
    <CustomSelect value={corner} onChange={(value) => setCorner(value as CameraCorner)}
      ariaLabel={t("recorderCameraPosition")} options={corners.map((value) => ({ value, label: t(`recorderCorner_${value}`) }))} />
  </div>;

  return <section className={styles.recorder} aria-label={t("recorderTitle")}>
    {!open ? <div className={styles.intro}>
      <div><h3>{t("recorderTitle")}</h3><p>{t("recorderIntro")}</p></div>
      <button type="button" className={styles.secondary} onClick={() => setOpen(true)}>{RecordVideoSVG}{t("recorderOpen")}</button>
    </div> : <>
      <div className={styles.heading}><h3>{t("recorderTitle")}</h3>
        {stage === "recording" && <span className={styles.timer}><span />{duration}</span>}
      </div>
      {stage === "idle" && <>
        <div className={styles.modes} role="group" aria-label={t("recorderMode")}>
          {modes.map((value) => <button key={value} type="button" aria-pressed={value === mode}
            onClick={() => setMode(value)} disabled={value === "camera" ? !supported.camera : !supported.screen || (value === "combined" && !supported.camera)}>
            {value === "screen" ? RecordScreenSVG : value === "camera" ? RecordCameraSVG : RecordVideoSVG}
            {t(`recorderMode_${value}`)}
          </button>)}
        </div>
        {(!supported.screen || !supported.camera) && <p className={styles.hint}>{t("recorderSupport")}</p>}
        <div className={styles.qualityPicker}>
          <span>{t("recorderQuality")}</span>
          <CustomSelect value={quality} onChange={(value) => setQuality(value as RecordingQuality)}
            ariaLabel={t("recorderQuality")} options={RECORDING_QUALITIES.map((value) => ({
              value, label: t(`recorderQuality_${value}`),
            }))} />
        </div>
        <p className={styles.hint}>{t("recorderQualityHint")}</p>
        <div className={styles.audio}>
          <label><input type="checkbox" className={checkboxClassName} checked={microphone} onChange={(event) => setMicrophone(event.target.checked)} />{t("recorderMicrophone")}</label>
          {mode !== "camera" && <label><input type="checkbox" className={checkboxClassName} checked={screenAudio} onChange={(event) => setScreenAudio(event.target.checked)} />{t("recorderScreenAudio")}</label>}
        </div>
        <p className={styles.hint}>{t("recorderLocalNotice")}</p>
      </>}
      {(stage === "ready" || stage === "recording") && sources && <>
        <div className={styles.preview}>
          <LiveVideo stream={sources.primary} />
          {sources.camera && <LiveVideo stream={sources.camera} className={`${styles.camera} ${styles[corner]}`} />}
        </div>
        {captureSettings?.width && captureSettings?.height && <p className={styles.hint}>{t("recorderCaptureQuality", {
          width: captureSettings.width, height: captureSettings.height, fps: Math.round(sources.frameRate),
        })}</p>}
        {sources.camera && cornerPicker}
        {screenAudio && mode !== "camera" && !sources.hasScreenAudio && <p className={styles.hint}>{t("recorderNoScreenAudio")}</p>}
      </>}
      {stage === "review" && draft && <>
        <p>{t("recorderReview")}</p>
        <ReviewVideo draft={draft} corner={corner} />
        {draft.camera && cornerPicker}
        {draft.camera && <p className={styles.hint}>{t("recorderExportNotice")}</p>}
      </>}
      {(stage === "requesting" || stage === "stopping") && <p role="status">{t(stage === "requesting" ? "recorderRequesting" : "recorderSaving")}</p>}
      {stage === "exporting" && <div className={styles.progress} role="status">
        <p>{t("recorderPreparing")} {Math.round(progress)}%</p>
        <progress max={100} value={progress} aria-label={t("recorderPreparing")} />
        <p className={styles.hint}>{t("recorderExportNotice")}</p>
      </div>}
      {errorKey && <p className={styles.error} role="alert">{t(errorKey)}</p>}
      <div className={styles.actions}>
        {stage !== "recording" && stage !== "stopping" && <button type="button" className={styles.secondary} onClick={() => {
          if (stage === "exporting") { operation.current?.abort(); setStage("review"); }
          else { reset(); setOpen(false); }
        }}>{t(stage === "review" ? "recorderDiscard" : "cancel")}</button>}
        {stage === "idle" && <button type="button" className={styles.primary} disabled={!supportedMode} onClick={() => void chooseSources()}>{t("recorderChooseSources")}</button>}
        {stage === "ready" && <button type="button" className={styles.primary} onClick={start}>{RecordVideoSVG}{t("recorderStart")}</button>}
        {stage === "recording" && <button type="button" className={styles.stop} onClick={() => void stop()}>{t("recorderStop")}</button>}
        {stage === "review" && <>
          <button type="button" className={styles.secondary} onClick={reset}>{t("recorderAgain")}</button>
          <button type="button" className={styles.primary} onClick={() => void accept()}>
            {t("recorderUse")}
          </button>
        </>}
      </div>
    </>}
  </section>;
}
