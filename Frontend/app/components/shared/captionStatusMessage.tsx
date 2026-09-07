import { TranscriptSVG } from "~/constants";
import { useI18n } from "~/i18n";

export function CaptionStatusMessage({ status, language }: {
  status: "loading" | "available" | "not_available" | "generating";
  language: string;
}) {
  const { t } = useI18n();
  if (status === "available") return null;
  const busy = status === "loading" || status === "generating";

  return (
    <div className={busy ? "captionsLoadingState" : "captionsNotAvailable"} role="status" aria-live="polite">
      <span className="captionStatusIcon" aria-hidden="true">
        {busy ? <span className="uploadSpinner small" /> : TranscriptSVG}
      </span>
      <div className="captionStatusCopy">
        <p>{busy ? t(status === "generating" ? "generatingCaptions" : "checkingCaptions") : t("editorNoCaptions", { language })}</p>
        <span>{busy ? t("editorCaptionsReadyHelp") : t("editorCaptionsCreateHelp")}</span>
      </div>
    </div>
  );
}
