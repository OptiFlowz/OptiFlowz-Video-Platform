import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { CloseSVG } from "~/constants";
import { getStoredUser, getToken } from "~/functions";
import { useI18n } from "~/i18n";
import LanguageSelect from "~/components/languageSelect/languageSelect";
import PopupPortal from "~/components/popupPortal/popupPortal";
import { OFFICE_EMAIL } from "~/changeables";
import { usePrivacyPreferences } from "~/privacy/privacyPreferences";
import { deleteMyAccount } from "./accountApi";

function SettingsPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale, setLocale, t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const { openPreferences } = usePrivacyPreferences();
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const deletingRef = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const userEmail = getStoredUser()?.user?.email;
  const resetPasswordUrl = userEmail
    ? `/forgot-password?user=${encodeURIComponent(userEmail)}`
    : "/forgot-password";
  const emailRequest = (subject: string, body: string) => `mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${body}${userEmail ? `\n\n${userEmail}` : ""}`)}`;
  const dataRequestUrl = emailRequest(t("accountDataRights"), t("accountDataRequestBody"));
  const privacyContactUrl = emailRequest(t("accountPrivacyContact"), t("accountPrivacyRequestBody"));
  const erasureRequestUrl = emailRequest(t("accountDelete"), t("accountErasureRequestBody"));

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setDeleteError(null);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => panelRef.current?.focus(), 30);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  const requestClose = () => { if (!deletingRef.current) onCloseRef.current(); };
  const showConfirmation = (show: boolean) => {
    if (deletingRef.current) return;
    setDeleteError(null);
    setConfirmDelete(show);
    panelRef.current?.focus();
  };
  const handleDelete = async () => {
    if (!confirmDelete || deletingRef.current) return;
    const token = getToken();
    if (!token) { setDeleteError("accountDeleteSignIn"); return; }
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMyAccount(token);
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
      setDeleteError(status === 409 ? "accountDeleteConflict" : status === 401 ? "accountDeleteSignIn" : "accountDeleteFailed");
      deletingRef.current = false;
      setDeleting(false);
      return;
    }
    // Clear account state only after confirmed deletion; keep language and privacy choices.
    localStorage.removeItem("user");
    sessionStorage.removeItem("user");
    localStorage.removeItem("rememberMe");
    await queryClient.cancelQueries();
    queryClient.clear();
    window.location.replace("/login");
  };

  return <PopupPortal>
    <div className={`popup settingsPopup ${open ? "active" : ""}`} inert={!open} aria-hidden={!open}>
      <div
        ref={panelRef}
        className="popup-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (confirmDelete) showConfirmation(false); else requestClose();
          }
          if (event.key !== "Tab") return;
          const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') ?? []).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first) { event.preventDefault(); panelRef.current?.focus(); }
          else if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
      >
        <div className="accountSettingsHeader">
          <div>
            <h2 id={titleId}>{t(confirmDelete ? "accountDeleteTitle" : "settings")}</h2>
            <p id={descriptionId}>{t(confirmDelete ? "accountDeleteHelp" : "accountSettingsHelp")}</p>
          </div>
          <button type="button" className="accountSettingsClose" onClick={requestClose} disabled={deleting} aria-label={t("close")}>{CloseSVG}</button>
        </div>

        <div className="accountSettingsBody" aria-busy={deleting}>
          {confirmDelete ? (
            <div className="accountDeleteConfirmation">
              {userEmail && <strong className="accountDeleteEmail">{userEmail}</strong>}
              <p>{t("accountDeleteConfirmation")}</p>
              {deleting && <p role="status">{t("accountDeleting")}</p>}
              {deleteError && <div className="accountDeleteError" role="alert"><p>{t(deleteError)}</p><a href={erasureRequestUrl}>{t("accountContactPrivacy")}</a></div>}
            </div>
          ) : (
            <>
              <div className="settingsRow">
                <div className="settingsRowText"><h3>{t("accountLanguage")}</h3><p>{t("accountLanguageHelp")}</p></div>
                <LanguageSelect value={locale} onChange={setLocale} ariaLabel={t("accountLanguage")} variant="settings" />
              </div>
              <div className="settingsRow">
                <div className="settingsRowText"><h3>{t("accountResetPassword")}</h3><p>{t("accountResetPasswordHelp")}</p></div>
                <Link className="accountSettingsAction" to={resetPasswordUrl}>{t("resetPassword")}</Link>
              </div>
              <div className="settingsRow">
                <div className="settingsRowText"><h3>{t("accountPrivacyChoices")}</h3><p>{t("accountPrivacyChoicesHelp")}</p></div>
                <button type="button" className="accountSettingsAction" onClick={() => { requestClose(); openPreferences(); }}>{t("accountManagePrivacy")}</button>
              </div>
              <div className="settingsRow">
                <div className="settingsRowText"><h3>{t("accountDataRights")}</h3><p>{t("accountDataRightsHelp")}</p></div>
                <a className="accountSettingsAction" href={dataRequestUrl}>{t("accountRequestData")}</a>
              </div>
              <div className="settingsRow">
                <div className="settingsRowText"><h3>{t("accountPrivacyContact")}</h3><p>{t("accountPrivacyContactHelp")}</p></div>
                <a className="accountSettingsAction" href={privacyContactUrl}>{t("accountContactPrivacy")}</a>
              </div>
              <div className="settingsRow accountSettingsDanger">
                <div className="settingsRowText"><h3>{t("accountDelete")}</h3><p>{t("accountDeleteHelp")}</p></div>
                <button type="button" className="accountSettingsAction accountDeleteAction" onClick={() => showConfirmation(true)}>{t("accountDelete")}</button>
              </div>
            </>
          )}
        </div>
        <div className="accountSettingsFooter">
          {confirmDelete ? <>
            <button type="button" className="accountSettingsAction" onClick={() => showConfirmation(false)} disabled={deleting}>{t("cancel")}</button>
            <button type="button" className="accountSettingsAction accountDeleteConfirm" onClick={() => void handleDelete()} disabled={deleting}>{t(deleting ? "accountDeleting" : "accountDelete")}</button>
          </> : <button type="button" className="accountSettingsAction" onClick={requestClose}>{t("close")}</button>}
        </div>
      </div>
      <button type="button" className="closePopup" onClick={requestClose} disabled={deleting} tabIndex={-1} aria-label={t("close")}></button>
    </div>
  </PopupPortal>;
}

export default SettingsPopup;
