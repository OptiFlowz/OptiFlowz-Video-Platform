import { fetchFn } from "~/API";

export type UserRole = { id: number | string; name: string };
export type PlatformUser = {
  id: string;
  email: string;
  full_name: string | null;
  image_url?: string | null;
  created_at: string;
  roles: UserRole[];
};
export type UserSortBy = "full_name" | "email" | "id" | "created_at" | "updated_at";
export type UserSearch = {
  q: string;
  role: string;
  page: number;
  limit: number;
  sortBy: UserSortBy;
  sortOrder: "asc" | "desc";
};
export type UserSearchResponse = {
  success: boolean;
  message?: string;
  users: PlatformUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  sorting: Pick<UserSearch, "sortBy" | "sortOrder">;
};

export async function searchPlatformUsers(search: UserSearch, token: string, signal?: AbortSignal) {
  const params = new URLSearchParams({
    page: String(search.page),
    limit: String(search.limit),
    sortBy: search.sortBy,
    sortOrder: search.sortOrder,
  });
  if (search.q.trim()) params.set("q", search.q.trim());
  if (search.role) params.set("role", search.role);

  const response = await fetchFn<UserSearchResponse>({
    route: `api/users/search?${params}`,
    options: { method: "GET", headers: { Authorization: `Bearer ${token}` }, signal },
  });
  if (!response?.success) throw new Error(response?.message || "Failed to load users.");
  return response;
}

export function getErrorStatus(error: unknown) {
  return error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
}

export function retryUserRequest(failureCount: number, error: Error) {
  const status = getErrorStatus(error);
  return failureCount < 1 && (status === undefined || status >= 500);
}

export async function changeUserRole(userId: string, roleId: string | number, action: 'assign' | 'remove', token: string) {
  const result = await fetchFn<{ success: boolean; message?: string }>({
    route: `api/users/${action}-role`,
    options: {
      method: action === 'assign' ? 'POST' : 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role_id: String(roleId) }),
    },
  });
  if (!result?.success) throw new Error(result?.message || 'Unable to change user roles.');
  return result;
}
