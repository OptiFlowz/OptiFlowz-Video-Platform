import { Link } from "react-router";
import { CloseSVG } from "~/constants";
import { getStoredUser } from "~/functions";
import { useI18n } from "~/i18n";
import LanguageSelect from "~/components/languageSelect/languageSelect";
import PopupPortal from "~/components/popupPortal/popupPortal";

function SettingsPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale, setLocale, t } = useI18n();
  const userEmail = getStoredUser()?.user?.email;
  const resetPasswordUrl = userEmail
    ? `/forgot-password?user=${encodeURIComponent(userEmail)}`
    : "/forgot-password";

  return <PopupPortal>
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
            <LanguageSelect
              value={locale}
              onChange={setLocale}
              ariaLabel={t("accountLanguage")}
              variant="settings"
            />
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
  </PopupPortal>;
}

export default SettingsPopup;
