import { useI18n } from "~/i18n";
import PlatformSettingsHeader from "./platformSettingsHeader";

export default function AdvancedSettings() {
  const { t } = useI18n();
  return (
    <>
      <PlatformSettingsHeader activePage="advanced" />
      <section className="platformSettingsCard platformSettingsPlaceholder">
        <h2>{t("settingsAdvancedTab")}</h2>
        <p>{t("settingsAdvancedHelp")}</p>
      </section>
    </>
  );
}
