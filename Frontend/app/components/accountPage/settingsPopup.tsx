import { Link } from "react-router";
import { CloseSVG } from "~/constants";
import { getStoredUser } from "~/functions";
import { LANGUAGE_OPTIONS, useI18n } from "~/i18n";

function SettingsPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale, setLocale, t } = useI18n();
  const userEmail = getStoredUser()?.user?.email;
  const resetPasswordUrl = userEmail
    ? `/forgot-password?user=${encodeURIComponent(userEmail)}`
    : "/forgot-password";

  return (
    <div className={`popup settingsPopup ${open ? "active" : ""}`}>
      <div className="popup-content">
        <h2>
          {t("settings")} <button onClick={onClose}>{CloseSVG}</button>
        </h2>

        <section aria-label={t("accountSettings")}>
          <div className="settingsRow">
            <div className="settingsRowText">
              <strong>{t("accountLanguage")}</strong>
              <p>{t("accountLanguageHelp")}</p>
            </div>
            <select
              id="platformLanguage"
              className="languageSelect settingsLanguageSelect"
              value={locale}
              onChange={(e) => setLocale(e.target.value as typeof locale)}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="settingsRow">
            <div className="settingsRowText">
              <strong>{t("accountResetPassword")}</strong>
              <p>{t("accountResetPasswordHelp")}</p>
            </div>
            <Link className="bg-(--background1) p-3 font-semibold rounded-xl transition-colors button text-center" to={resetPasswordUrl}>{t("resetPassword")}</Link>
          </div>
        </section>
      </div>

      <button className="closePopup" onClick={onClose}></button>
    </div>
  );
}

export default SettingsPopup;
