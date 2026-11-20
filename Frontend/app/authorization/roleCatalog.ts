import { queryOptions } from "@tanstack/react-query";
import { fetchFn } from "~/API";

export type ApiRole = {
  id: string;
  name: string;
  position: number;
  is_system: boolean;
  is_default: boolean;
  is_owner: boolean;
  member_count: number;
  permissions: Array<{ id: number; key?: string; effect: "allow" | "deny" }>;
  can_update: boolean;
  can_delete: boolean;
};

type RoleCatalog = { success: boolean; roles: ApiRole[] };

export function roleCatalogQuery(token: string | null) {
  return queryOptions({
    queryKey: ["roles", token],
    queryFn: async ({ signal }) => {
      const result = await fetchFn<RoleCatalog>({
        route: "api/roles",
        options: { headers: { Authorization: `Bearer ${token}` }, signal },
      });
      if (!result?.success || !Array.isArray(result.roles)) throw new Error("Unable to load roles.");
      return result;
    },
  });
}
