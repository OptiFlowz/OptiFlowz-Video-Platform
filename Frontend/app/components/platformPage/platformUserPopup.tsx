import { useRoleLabel } from "~/authorization/roleLabels";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthorization, type RoleDefinition } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { getToken } from "~/functions";
import CustomSelect from "~/components/customSelect/customSelect";
import { changeUserRole, type UserSearchResponse } from "./platformUsersApi";
import { useEffect, useId, useRef, useState } from "react";
import PopupPortal from "~/components/popupPortal/popupPortal";
import { CloseSVG } from "~/constants";
import { useI18n } from "~/i18n";
import type { PlatformUser, UserRole } from "./platformUsersApi";
import PlatformUserAvatar from "./platformUserAvatar";

export function formatUserDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function UserRoleBadges({ roles }: { roles: UserRole[] }) {
  const { t } = useI18n();
  const roleLabel = useRoleLabel();
  return <div className="platformUserRoles">{roles.length ? roles.map((role) => <span className="roleTypeBadge system" key={role.id}>{roleLabel(role)}</span>) : <span className="platformUserNoRoles">{t("usersNoRoles")}</span>}</div>;
}

export default function PlatformUserPopup({ user, onClose }: { user: PlatformUser | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const roleLabel = useRoleLabel();
  const [displayedUser, setDisplayedUser] = useState(user);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const client = useQueryClient();
  const { user: actorUser, roles, rolesLoading, rolesError, refreshRoles, can, refresh } = useAuthorization();
  const [roleToAssign, setRoleToAssign] = useState('');
  const [roleNotice, setRoleNotice] = useState('');
  const actorRoleIds = new Set(actorUser?.roles?.map(role => String(role.id)) ?? []);
  const actorRoles = roles.filter(role => actorRoleIds.has(String(role.id)));
  const hasActorHierarchy = actorRoles.length > 0
    && actorRoles.length === actorRoleIds.size
    && actorRoles.every(role => Number.isFinite(role.position));
  const highestRolePosition = Math.min(...actorRoles.map(role => role.position));
  const actorIsOwner = actorRoles.some(role => role.is_owner);
  const canAssignRole = (role: RoleDefinition) => !rolesLoading && !rolesError
    && hasActorHierarchy && !role.is_owner && Number.isFinite(role.position)
    // Lower position values mean higher rank in the backend hierarchy.
    && (actorIsOwner || role.position > highestRolePosition);
  const roleMutation = useMutation({
    mutationFn: ({ target, role, action }: { target: PlatformUser; role: UserRole; action: 'assign' | 'remove' }) => {
      if (!can(P.usersAssignRoles)) throw new Error(t('usersRoleChangeFailed'));
      if (action === 'assign' && !roles.some(item => String(item.id) === String(role.id) && canAssignRole(item))) {
        throw new Error(t('usersRoleChangeFailed'));
      }
      return changeUserRole(target.id, role.id, action, getToken() ?? '');
    },
    onSuccess: (_, { target, role, action }) => {
      const nextUser = { ...target, roles: action === 'assign' ? [...target.roles.filter(item => String(item.id) !== String(role.id)), role] : target.roles.filter(item => String(item.id) !== String(role.id)) };
      setDisplayedUser(nextUser);
      setRoleToAssign('');
      setRoleNotice(t('usersRoleChanged'));
      client.setQueriesData<UserSearchResponse>({ queryKey: ['platform-users'] }, current => current ? { ...current, users: current.users.map(item => item.id === target.id ? nextUser : item) } : current);
    },
    onSettled: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ['platform-users'] }), refresh()]);
    },
  });
  const savingRef = useRef(false);
  savingRef.current = roleMutation.isPending;
  const requestClose = () => { if (!savingRef.current) onClose(); };
  const availableRoles = roles.filter(role => canAssignRole(role) && !displayedUser?.roles.some(current => String(current.id) === String(role.id)));
  const selectedAssignableRole = availableRoles.find(role => String(role.id) === roleToAssign);

  useEffect(() => {
    if (roleToAssign && !selectedAssignableRole) setRoleToAssign('');
  }, [roleToAssign, selectedAssignableRole]);

  useEffect(() => {
    if (user) {
      setDisplayedUser(user);
      setRoleToAssign('');
      setRoleNotice('');
      roleMutation.reset();
      const timer = window.setTimeout(() => setVisible(true), 20);
      return () => window.clearTimeout(timer);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setDisplayedUser(null), 200);
    return () => window.clearTimeout(timer);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => panelRef.current?.focus(), 30);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!savingRef.current) onClose(); }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      const focusable = Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); panel?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [user, onClose]);

  if (!displayedUser) return null;
  return <PopupPortal>
    <div className={`platformRolePopup platformUserPopup ${visible ? "visible" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div className="platformRolePopupBackdrop bg-(--backgroundC1)" onMouseDown={requestClose} />
      <div ref={panelRef} className="platformRolePopupPanel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="platformRolePopupHeader platformUserPopupHeader">
          <div><h3 id={titleId}>{t("usersDetails")}</h3><p>{t("usersDetailsDescription")}</p></div>
          <button type="button" className="platformUserClose" aria-label={t("close")} onClick={requestClose} disabled={roleMutation.isPending}>{CloseSVG}</button>
        </div>
        <div className="platformRolePopupBody">
          <div className="platformUserSummary"><PlatformUserAvatar imageUrl={displayedUser.image_url} /><strong>{displayedUser.full_name?.trim() || t("usersUnnamed")}</strong></div>
          <dl className="platformUserDetails">
            <div><dt>{t("usersEmail")}</dt><dd>{displayedUser.email}</dd></div>
            <div><dt>{t("usersJoined")}</dt><dd>{formatUserDate(displayedUser.created_at, locale)}</dd></div>
          </dl>
          <section className="platformUserRoleEditor" aria-label={t('usersRoles')}>
            <div><h4>{t('usersRoles')}</h4><p>{t(can(P.usersAssignRoles) ? 'usersRolesHelp' : 'usersRolesReadOnly')}</p></div>
            {displayedUser.roles.length ? displayedUser.roles.map(role => <div className="platformDefaultRoleControl" key={role.id}>
              <strong>{roleLabel(role)}</strong>
              {can(P.usersAssignRoles) && <button type="button" className="platformUserRemoveRole" disabled={roleMutation.isPending} aria-label={`${t('usersRemoveRole')}: ${roleLabel(role)}`} onClick={() => { setRoleNotice(''); roleMutation.mutate({ target: displayedUser, role, action: 'remove' }); }}>{t('usersRemoveRole')}</button>}
            </div>) : <p>{t('usersNoRoles')}</p>}
            {can(P.usersAssignRoles) && (rolesLoading ? <p role="status">{t('usersRolesLoading')}</p> : rolesError ? <div className="rolesTableState errorBanner" role="alert"><p>{t('usersRolesLoadFailed')}</p><button type="button" onClick={() => void refreshRoles()}>{t('usersRetry')}</button></div> : availableRoles.length ? <div className="platformUserAssignRole">
              <CustomSelect value={roleToAssign} options={[{ value: '', label: t('usersChooseRole'), disabled: true }, ...availableRoles.map(role => ({ value: String(role.id), label: roleLabel(role) }))]} onChange={setRoleToAssign} ariaLabel={t('usersChooseRole')} disabled={roleMutation.isPending} />
              <button type="button" className="addRoleButton" disabled={!selectedAssignableRole || roleMutation.isPending} onClick={() => { if (selectedAssignableRole) { setRoleNotice(''); roleMutation.mutate({ target: displayedUser, role: { id: selectedAssignableRole.id, name: selectedAssignableRole.name }, action: 'assign' }); } }}>{t('usersAssignRole')}</button>
            </div> : <p>{t('usersNoAvailableRoles')}</p>)}
            {roleMutation.error && <p className="platformRoleMutationError" role="alert">{t('usersRoleChangeFailed')}</p>}
            <p role="status">{roleMutation.isPending ? t('usersRoleSaving') : roleNotice}</p>
          </section>
        </div>
        <div className="platformRolePopupActions"><button type="button" className="platformRoleCancelButton" onClick={requestClose} disabled={roleMutation.isPending}>{t("close")}</button></div>
      </div>
    </div>
  </PopupPortal>;
}
