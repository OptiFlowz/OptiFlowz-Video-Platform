import { useI18n } from "~/i18n";

export function PlaybackFeedback({ error, retry }: { error: boolean; retry: () => void }) {
  const { t } = useI18n();
  return <div className="videoPreviewPlaceholder" role="status">
    <p>{t(error ? "videoPlaybackUnavailable" : "loadingVideoPreview")}</p>
    {error && <button type="button" className="cancelBtn" onClick={retry}>{t("usersRetry")}</button>}
  </div>;
}
