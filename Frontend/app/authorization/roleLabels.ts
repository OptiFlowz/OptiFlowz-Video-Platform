import { useAuthorization } from "./authorization";
import { useI18n } from "~/i18n";

const systemRoleKeys: Record<string, string> = {
  owner: "systemRoleOwner",
  administrator: "systemRoleAdministrator",
  moderator: "systemRoleModerator",
  uploader: "systemRoleUploader",
  viewer: "systemRoleViewer",
};

export function getRoleLabel(name: string, isSystem: boolean, t: (key: string) => string) {
  const key = isSystem ? systemRoleKeys[name.trim().toLowerCase()] : undefined;
  return key ? t(key) : name;
}

export function useRoleLabel() {
  const { roles } = useAuthorization();
  const { t } = useI18n();
  return (role: { id: string | number; name: string; is_system?: boolean; is_owner?: boolean }) => {
    const definition = roles.find(item => String(item.id) === String(role.id));
    return getRoleLabel(role.name, role.is_system === true || role.is_owner === true || definition?.is_system === true || definition?.is_owner === true, t);
  };
}
