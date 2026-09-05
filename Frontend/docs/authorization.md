# Frontend authorization

`app/authorization/authorization.tsx` provides `useAuthorization()` (`can`, `canAny`, `canOwn`, `canAccess`). Effective permissions come exclusively from `GET /api/users/me/permissions`:

```json
{
  "success": true,
  "permissions": ["users.search", "analytics.platform.read"]
}
```

Requests use the current bearer token. The backend resolves active roles, deny rules and owner access. The frontend checks exact membership in the returned string array: no role-name inference, legacy aliases, locally merged permissions, or owner bypass. Empty permissions grant no protected actions. Missing, malformed or failed permission responses fail closed. All string keys are retained, including future permissions; adding a new key does not require changing the resolver. Add a constant/action or route mapping when a new frontend feature needs that key.

`GET /api/auth/me` supplies the profile and `user.roles: [{ id, name }]`. `user.id` is preferred for ownership; the authenticated JWT subject is used when `/me` omits it. Profile data is synchronized to the existing session storage, but effective permissions are read from the session-scoped React Query cache rather than stored profile data.

`app/authorization/permissions.ts` maps routes and actions to backend keys. `users.search` opens Platform Users and user details; `users.assign_roles` separately enables assignment and removal. The current own-library and own-channel endpoints require their `_own` permission. Resource-specific edit/analytics routes also accept `_any`; backend resource authorization remains responsible for checking ownership.

The role catalog (`GET /api/roles`) is optional for authorization and fetched only for users with `roles.manage`, `users.search`, or `users.assign_roles`. It supplies names for filters and role pickers, plus `is_owner` metadata for existing settings tabs without dedicated permissions. Catalog failures never revoke effective permissions or block the user list; role controls show their own loading/error state. Backend access to this catalog is still required to use those pickers. `GET /api/roles/permissions` is now used only by Access & Roles to edit role definitions, not by the global authorization provider.

Branding, homepage and advanced settings currently retain their owner-only metadata check; `roles.manage` opens Access & Roles. Existing UEMS reading-list membership is separately recognized from the UEMS role in `user.roles` (or owner metadata); no dedicated UEMS permission exists in the supplied permission list. These metadata checks do not grant any permission key.

Queries are scoped by token and refresh on window focus after becoming stale. Assigning/removing user roles refreshes `/me`, effective permissions, the role catalog and user search. Creating, editing or deleting role definitions invalidates both the role catalog and effective permissions, updating mounted components.

Platform Users uses `GET /api/users/search` with `q`, `role`, `page`, `limit`, `sortBy`, `sortOrder`. Assignment uses `POST /api/users/assign-role`; removal uses `DELETE /api/users/remove-role`. Both send `{ user_id, role_id }` as JSON. Each popup action persists immediately and displays any API error.
