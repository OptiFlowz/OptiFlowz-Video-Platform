"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getStoredUser } from "~/functions";
import { useAuthorization } from "~/authorization/authorization";
import type { AccessSection } from "~/authorization/permissions";
import { useI18n } from "~/i18n";

export type GuardMode = "public" | "auth" | "uems";
export default function ClientGuard({ mode, access, children }: { mode: GuardMode; access?: AccessSection; children: React.ReactNode }) {
  const router = useRouter();
  const { loading: permissionsLoading, error, rolesLoading, canAccess, isOwner, user, refresh } = useAuthorization();
  const { t } = useI18n();
  const hasUser = !!getStoredUser();
  const loading = permissionsLoading || (mode === 'uems' && rolesLoading);
  const protectedPage = !!access || mode === 'uems';
  // UEMS is a membership reading list, separate from platform-management permissions.
  const allowed = mode === 'public' && !access || (hasUser && (!protectedPage || (!loading && !error && (access ? canAccess(access) : isOwner || user?.roles?.some(role => role.name.toLowerCase() === 'uems')))));
  useEffect(() => {
    if (mode === 'public' && !access) return;
    if (!hasUser) {
      const target = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      router.replace(`/login?redirect=${encodeURIComponent(target)}`);
    } else if (protectedPage && !loading && !error && !allowed) router.replace('/');
  }, [mode, access, hasUser, protectedPage, loading, error, allowed, router]);
  if (protectedPage && hasUser && error) return <div className="platformUsersState" role="alert"><p>{t('accessLoadFailed')}</p><button type="button" className="addRoleButton" onClick={() => void refresh()}>{t('usersRetry')}</button></div>;
  if (!allowed) return null;
  return <>{children}</>;
}
