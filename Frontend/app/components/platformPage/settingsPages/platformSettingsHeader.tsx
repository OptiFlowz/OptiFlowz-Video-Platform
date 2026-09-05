import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { Link } from "react-router";
import { useI18n } from "~/i18n";

export type PlatformSettingsPageKey = "branding" | "homepage" | "access" | "advanced";

type PlatformSettingsHeaderProps = {
  activePage: PlatformSettingsPageKey;
};

const tabs: Array<{ key: PlatformSettingsPageKey; label: string; icon: React.ReactNode }> = [
  {
    key: "branding",
    label: "settingsBrandingTab",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 0-3.6h-.7a1.5 1.5 0 0 1 0-3h2.1A6.4 6.4 0 0 0 21 8c0-3.1-4-5-9-5Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10" cy="6.8" r="1"/><circle cx="15" cy="7" r="1"/></svg>,
  },
  {
    key: "homepage",
    label: "settingsHomepageTab",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M9 4v16M12 8h5M12 12h5"/></svg>,
  },
  {
    key: "access",
    label: "settingsAccessTab",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19M15 6.5a3 3 0 0 1 0 5.8M16.5 14a4.5 4.5 0 0 1 4 4.5V19"/></svg>,
  },
  {
    key: "advanced",
    label: "settingsAdvancedTab",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.7 6.3 3-3 3 3-3 3M13.5 7.5l-10 10a2.1 2.1 0 0 0 3 3l10-10M5 4l2 2M4 9h3M15 17l2 2M19 14v3"/></svg>,
  },
];

export default function PlatformSettingsHeader({ activePage }: PlatformSettingsHeaderProps) {
  const { t } = useI18n();
  const { isOwner } = useAuthorization();

  return (
    <>
      <header className="platformSettingsHeader libraryHeading">
        <h1>{t("platformSettings")}</h1>
        <p>{t("platformSettingsDescription")}</p>
      </header>
      <nav className="platformSettingsTabs" aria-label={t("settingsSections")}>
        {tabs.filter(tab => isOwner || tab.key === "access").map((tab) => (
          <Link
            key={tab.key}
            to={`?page=${tab.key}`}
            className={tab.key === activePage ? "active" : ""}
            aria-current={tab.key === activePage ? "page" : undefined}
          >
            {tab.icon}
            <span>{t(tab.label)}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
