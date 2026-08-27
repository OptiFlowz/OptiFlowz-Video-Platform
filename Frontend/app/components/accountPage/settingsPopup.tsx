import { Link } from "react-router";
import { CloseSVG } from "~/constants";
import { getStoredUser } from "~/functions";
import { useI18n } from "~/i18n";
import LanguageSelect from "~/components/languageSelect/languageSelect";
import PopupPortal from "~/components/popupPortal/popupPortal";
import { OFFICE_EMAIL } from "~/changeables";
import { usePrivacyPreferences } from "~/privacy/privacyPreferences";

const SETTINGS_ACTION_CLASS = "bg-(--background1) p-3 font-semibold rounded-xl transition-colors button text-center";

function SettingsPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale, setLocale, t } = useI18n();
  const { openPreferences } = usePrivacyPreferences();
  const userEmail = getStoredUser()?.user?.email;
  const resetPasswordUrl = userEmail
    ? `/forgot-password?user=${encodeURIComponent(userEmail)}`
    : "/forgot-password";
  const dataRequestUrl = `mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent("GDPR data access and portability request")}&body=${encodeURIComponent(`Please provide access to and a portable copy of the personal data associated with ${userEmail ?? "my platform account"}. I understand that you may need to verify my identity.`)}`;
  const privacyContactUrl = `mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent("GDPR restriction or objection request")}&body=${encodeURIComponent(`I am contacting you about the processing of personal data associated with ${userEmail ?? "my platform account"}. Please contact me to handle my request and verify my identity.`)}`;

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
            <Link className={SETTINGS_ACTION_CLASS} to={resetPasswordUrl}>{t("resetPassword")}</Link>
          </div>
          <div className="settingsRow">
            <div className="settingsRowText">
              <strong>{t("accountPrivacyChoices")}</strong>
              <p>{t("accountPrivacyChoicesHelp")}</p>
            </div>
            <button type="button" className={SETTINGS_ACTION_CLASS} onClick={openPreferences}>{t("accountManagePrivacy")}</button>
          </div>
          <div className="settingsRow">
            <div className="settingsRowText">
              <strong>{t("accountDataRights")}</strong>
              <p>{t("accountDataRightsHelp")}</p>
            </div>
            <a className={SETTINGS_ACTION_CLASS} href={dataRequestUrl}>{t("accountRequestData")}</a>
          </div>
          <div className="settingsRow">
            <div className="settingsRowText">
              <strong>{t("accountPrivacyContact")}</strong>
              <p>{t("accountPrivacyContactHelp")}</p>
            </div>
            <a className={SETTINGS_ACTION_CLASS} href={privacyContactUrl}>{t("accountContactPrivacy")}</a>
          </div>
        </section>
      </div>

      <button className="closePopup" onClick={onClose}></button>
    </div>
  </PopupPortal>;
}

export default SettingsPopup;
