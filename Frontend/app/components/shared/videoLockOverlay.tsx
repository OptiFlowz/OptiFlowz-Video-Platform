import { LockSVG } from "~/constants";
import { useI18n } from "~/i18n";

export function VideoLockOverlay() {
  const { t } = useI18n();
  return <span className="videoLockOverlay">
    <span aria-hidden="true">{LockSVG}</span>
    <small>{t("insufficientPermissions")}</small>
  </span>;
}
