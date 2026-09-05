import { fetchFn } from "~/API";

export async function deleteMyAccount(token: string) {
  const result = await fetchFn<{ success: boolean; deleted: boolean }>({
    route: "api/users/me",
    options: { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  });
  if (result?.success !== true || result.deleted !== true) {
    throw new Error("Account deletion was not confirmed.");
  }
}
