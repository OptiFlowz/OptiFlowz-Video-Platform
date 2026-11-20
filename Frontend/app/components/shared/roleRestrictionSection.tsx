import { useQuery } from "@tanstack/react-query";
import { useId, useState, type Dispatch, type SetStateAction } from "react";
import { roleCatalogQuery } from "~/authorization/roleCatalog";
import { getRoleLabel } from "~/authorization/roleLabels";
import { passwordHideSVG, passwordShowSVG } from "~/constants";
import { useI18n } from "~/i18n";
import styles from "../uploadPage/uploadStatus.module.css";

type RoleRestrictionDraft = {
  enabled: boolean;
  roleIds: string[];
  hideBanner: boolean;
};

export function useRoleRestrictionDraft() {
  return useState<RoleRestrictionDraft>({ enabled: false, roleIds: [], hideBanner: true });
}

type Props = {
  token: string;
  draft: RoleRestrictionDraft;
  setDraft: Dispatch<SetStateAction<RoleRestrictionDraft>>;
  disabled: boolean;
};

export default function RoleRestrictionSection({ token, draft, setDraft, disabled }: Props) {
  const { t } = useI18n();
  const id = useId();
  const { data, isPending, isError, refetch } = useQuery({
    ...roleCatalogQuery(token),
    enabled: !!token && draft.enabled,
    staleTime: Infinity,
  });

  function toggleRole(id: string, checked: boolean) {
    setDraft(current => ({
      ...current,
      roleIds: checked ? [...current.roleIds, id] : current.roleIds.filter(roleId => roleId !== id),
    }));
  }

  return (
    <section className={styles.schedule} aria-labelledby={`${id}-heading`}>
      <label className={styles.scheduleToggle}>
        <input type="checkbox" checked={draft.enabled} disabled={disabled} aria-describedby={`${id}-help`}
          onChange={({ target: { checked } }) => setDraft(current => ({ ...current, enabled: checked }))} />
        <span id={`${id}-heading`}>{t("uploadRoleRestriction")}</span>
      </label>
      <p id={`${id}-help`} className="formHint">{t("uploadRoleRestrictionHelp")}</p>
      {draft.enabled && (
        <div className={styles.roleFields}>
          <fieldset disabled={disabled}>
            <legend>{t("usersRoles")}</legend>
            {isPending ? <p role="status">{t("rolesLoading")}</p>
              : isError ? <div role="status">
                <p>{t("rolesLoadFailed")}</p>
                <button type="button" className={styles.retryRoles} onClick={() => void refetch()}>{t("usersRetry")}</button>
              </div>
              : data.roles.length === 0 ? <p role="status">{t("rolesEmpty")}</p>
              : <div className={styles.roleOptions}>
                {data.roles.map(role => (
                  <label key={role.id} className={styles.scheduleToggle}>
                    <input type="checkbox" checked={draft.roleIds.includes(role.id)}
                      onChange={event => toggleRole(role.id, event.target.checked)} />
                    <span>{getRoleLabel(role.name, role.is_system, t)}</span>
                  </label>
                ))}
              </div>}
          </fieldset>
          <label className={`${styles.scheduleToggle} ${styles.bannerOption}`}>
            <span className={styles.bannerIcon} aria-hidden="true">
              {draft.hideBanner ? passwordHideSVG : passwordShowSVG}
            </span>
            <span className={styles.bannerText}>
              <strong id={`${id}-banner-label`}>{t("uploadRoleHideBanner")}</strong>
              <small id={`${id}-banner-help`}>{t("uploadRoleHideBannerHelp")}</small>
            </span>
            <input type="checkbox" checked={draft.hideBanner} disabled={disabled}
              aria-labelledby={`${id}-banner-label`} aria-describedby={`${id}-banner-help`}
              onChange={({ target: { checked } }) => setDraft(current => ({ ...current, hideBanner: checked }))} />
          </label>
        </div>
      )}
    </section>
  );
}
