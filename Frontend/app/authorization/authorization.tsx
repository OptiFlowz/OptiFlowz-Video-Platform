"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchFn } from '~/API';
import { getStoredUser, getToken } from '~/functions';
import type { AuthFetchT } from '~/types';
import { P, accessPermissions, type AccessSection } from './permissions';

export type RoleDefinition = {
  id: string | number; name: string; is_owner: boolean; is_system?: boolean; position: number;
  permissions: Array<{ id: string | number; key?: string; effect: 'allow' | 'deny' }>;
  can_update?: boolean; can_delete?: boolean;
};
type RoleCatalog = { success: boolean; roles: RoleDefinition[] };
type UserPermissionsResponse = { success: boolean; permissions: string[]; message?: string };

function createAccess(user?: AuthFetchT['user'], permissionKeys: readonly string[] = []) {
  // The backend resolves active roles, deny rules and owner permissions.
  // Keep every returned key, including permissions added after this frontend release.
  const permissions = new Set(permissionKeys);
  const can = (permission: string) => !!user && permissions.has(permission);
  const canAny = (keys: readonly string[]) => keys.some(can);
  const canAccess = (section: AccessSection) => canAny(accessPermissions[section]);
  const canOwn = (own: string, any: string, ownerId?: string | null) => can(any) || (!!user?.id && ownerId === user.id && can(own));
  return { user, can, canAny, canAccess, canOwn };
}
const AuthorizationContext = createContext({
  ...createAccess(), loading: false, error: null as Error | null,
  roles: [] as RoleDefinition[], rolesLoading: false, rolesError: null as Error | null,
  isOwner: false, refresh: async () => {}, refreshRoles: async () => {},
});

export function AuthorizationProvider({ children }: { children: ReactNode }) {
  const token = getToken();
  const client = useQueryClient();
  const options = { enabled: !!token, staleTime: 30_000, refetchOnWindowFocus: true, retry: (count: number, error: Error) => count < 1 && !('status' in error && [401, 403].includes(Number(error.status))) };
  const query = useQuery({
    ...options, queryKey: ['accountInfo', token],
    queryFn: ({ signal }) => fetchFn<AuthFetchT>({ route: 'api/auth/me', options: { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal } }),
  });
  const permissionQuery = useQuery({
    ...options, queryKey: ['user-permissions', token],
    queryFn: async ({ signal }) => {
      const result = await fetchFn<UserPermissionsResponse>({ route: 'api/users/me/permissions', options: { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal } });
      if (!result?.success || !Array.isArray(result.permissions) || !result.permissions.every(key => typeof key === 'string')) {
        throw new Error(result?.message || 'Unable to load permissions.');
      }
      return result;
    },
  });
  const error = query.error ?? permissionQuery.error;
  const user = useMemo(() => {
    if (!token || query.isError || !query.data?.user) return undefined;
    if (query.data.user.id) return query.data.user;
    try {
      const payload = token.split('.')[1];
      const encoded = payload.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
      return { ...query.data.user, id: typeof claims.sub === 'string' ? claims.sub : undefined };
    } catch { return query.data.user; }
  }, [token, query.data, query.isError]);
  const access = useMemo(() => createAccess(user, !error ? permissionQuery.data?.permissions : []), [user, permissionQuery.data, error]);

  // Optional catalog for role pickers and owner-only settings metadata.
  // Its availability never determines the user's effective permission keys.
  const needsRoles = !!token && access.canAny([P.rolesManage, P.usersSearch, P.usersAssignRoles]);
  const roleQuery = useQuery({
    ...options, enabled: needsRoles, queryKey: ['roles', token],
    queryFn: async ({ signal }) => {
      const result = await fetchFn<RoleCatalog>({ route: 'api/roles', options: { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal } });
      if (!result?.success || !Array.isArray(result.roles)) throw new Error('Unable to load roles.');
      return result;
    },
  });
  useEffect(() => {
    if (!user || !token || getToken() !== token) return;
    const storage = sessionStorage.getItem('user') ? sessionStorage : localStorage;
    const stored = getStoredUser();
    if (!stored) return;
    const { role: _legacyRole, permissions: _permissions, is_owner: _owner, ...profile } = stored.user ?? {};
    storage.setItem('user', JSON.stringify({ ...stored, user: { ...profile, ...user, roles: user.roles ?? [] } }));
  }, [user, token]);
  const value = useMemo(() => {
    const roles = needsRoles && !roleQuery.isError ? roleQuery.data?.roles ?? [] : [];
    const roleIds = new Set(user?.roles?.map(role => String(role.id)) ?? []);
    return {
      ...access,
      loading: !!token && (query.isPending || permissionQuery.isPending), error,
      roles, rolesLoading: needsRoles && roleQuery.isPending, rolesError: needsRoles ? roleQuery.error : null,
      // Metadata only: this flag never bypasses can()/canAccess().
      isOwner: roles.some(role => role.is_owner === true && roleIds.has(String(role.id))),
      refresh: async () => { await Promise.all(['accountInfo', 'user-permissions', 'roles'].map(key => client.invalidateQueries({ queryKey: [key, token] }))); },
      refreshRoles: async () => { await roleQuery.refetch(); },
    };
  }, [access, user, needsRoles, roleQuery.data, roleQuery.isPending, roleQuery.isError, roleQuery.error, roleQuery.refetch, token, query.isPending, permissionQuery.isPending, error, client]);
  return <AuthorizationContext.Provider value={value}>{children}</AuthorizationContext.Provider>;
}

export function useAuthorization() { return useContext(AuthorizationContext); }
