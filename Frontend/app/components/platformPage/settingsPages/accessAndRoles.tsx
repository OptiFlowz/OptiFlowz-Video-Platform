import { permissionLabel, permissionGroupLabel } from "~/authorization/permissionLabels";
import { useI18n } from "~/i18n";
import { getRoleLabel } from "~/authorization/roleLabels";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { fetchFn } from "~/API";
import { ConfirmDialog } from "~/components/confirmPopup/confirmDialog";
import { useConfirm } from "~/components/confirmPopup/useConfirm";
import {
  AutoPlaySVG,
  BookmarkSVG,
  LibrarySVG,
  PermissionAddCircleSVG,
  PermissionAnalyticsSVG,
  PermissionChatSVG,
  PermissionClearSVG,
  PermissionEditSVG,
  PermissionEyeSVG,
  PermissionHandSVG,
  PermissionPaletteSVG,
  PermissionSettingsSVG,
  PermissionUsersSVG,
  RoleAddSVG,
  RoleDeleteSVG,
  RoleWrenchSVG,
  ShareSVG,
  ThumbIcon,
  UploadSVG,
} from "~/constants";
import PlatformSettingsHeader from "./platformSettingsHeader";

type PermissionId = string;

type RolePermission = {
  id: PermissionId;
  key: string;
  description: string;
  group_name: string;
  resource_type: string | null;
  risk_level: "normal" | "sensitive" | "dangerous";
};

type PermissionGroup = {
  name: string;
  permissions: RolePermission[];
};

type RolePermissionsResponse = {
  success: boolean;
  groups: PermissionGroup[];
};

type ApiRole = {
  id: string;
  name: string;
  position: number;
  is_system: boolean;
  is_default: boolean;
  is_owner: boolean;
  member_count: number;
  permissions: Array<{
    id: number;
    effect: "allow" | "deny";
  }>;
  can_update: boolean;
  can_delete: boolean;
};

type RolesResponse = {
  success: boolean;
  roles: ApiRole[];
};

type PlatformRole = {
  id: string;
  name: string;
  type: "System" | "Custom";
  users: number;
  permissions: PermissionId[];
  deniedPermissions: PermissionId[];
  position: number;
  isDefault: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

function getPermissionIcon(permission: RolePermission) {
  const group = permission.group_name.toLowerCase();
  const key = permission.key.toLowerCase();

  if (key.includes("delete")) return RoleDeleteSVG;
  if (key.includes("react")) return <ThumbIcon />;
  if (key.includes("progress") || key.includes("participate")) return AutoPlaySVG;
  if (key.includes("export")) return ShareSVG;
  if (key.includes("save")) return BookmarkSVG;
  if (key === "videos.create") return UploadSVG;
  if (key.includes("library.read")) return LibrarySVG;
  if (group === "analytics" || group === "reports") return PermissionAnalyticsSVG;
  if (group === "comments") return PermissionChatSVG;
  if (group === "members" || group === "people") return PermissionUsersSVG;
  if (group === "roles") return PermissionSettingsSVG;
  if (key.includes("create")) return PermissionAddCircleSVG;
  if (key.includes("update") || key.includes("manage")) return PermissionEditSVG;
  if (group === "quizzes") return PermissionPaletteSVG;
  return PermissionEyeSVG;
}

const chartColors = [
	"var(--analyticsChart1)",
	"var(--analyticsChart2)",
	"var(--analyticsChart3)",
	"var(--analyticsChart4)",
	"var(--analyticsChart5)",
];

function RoleOverview({ roles }: { roles: PlatformRole[] }) {
  const { t, locale } = useI18n();
  const label = (role: PlatformRole) => getRoleLabel(role.name, role.type === "System", t);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const totalUsers = roles.reduce((total, role) => total + role.users, 0);
  const activeRole = activeIndex === null ? null : roles[activeIndex];

  return (
    <section className="platformSettingsCard roleOverviewCard">
      <h2>{t("rolesOverview")}</h2>
      <div className="roleOverviewLayout">
        <div className="roleOverviewChart">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={roles}
                dataKey="users"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="62%"
                outerRadius="92%"
                paddingAngle={1}
                cornerRadius={3}
                stroke="var(--background1)"
                strokeWidth={2}
                animationDuration={500}
                onMouseEnter={(_, index) => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                {roles.map((role, index) => (
                  <Cell key={role.id} fill={chartColors[index % chartColors.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="roleOverviewCenter">
            <strong>{activeRole?.users ?? totalUsers}</strong>
            <span>{activeRole ? label(activeRole) : t("rolesAssignments")}</span>
          </div>
        </div>

        <div className="roleOverviewLegend">
          {roles.map((role, index) => {
            const percentage = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(totalUsers > 0 ? role.users / totalUsers : 0);
            return (
              <div className="roleOverviewLegendItem" key={role.id}>
                <i style={{ backgroundColor: chartColors[index % chartColors.length] }} />
                <span><strong>{label(role)}</strong><small>{role.users} ({percentage})</small></span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RolePopup({
  open,
  role,
  permissionGroups,
  isPermissionsLoading,
  permissionsError,
  onRetryPermissions,
  isSaving,
  saveError,
  onClose,
  onSave,
}: {
  open: boolean;
  role: PlatformRole | null;
  permissionGroups: PermissionGroup[];
  isPermissionsLoading: boolean;
  permissionsError: Error | null;
  onRetryPermissions: () => void;
  isSaving: boolean;
  saveError: Error | null;
  onClose: () => void;
  onSave: (name: string, selectedPermissions: PermissionId[], isDefault: boolean) => void;
}) {
  const { t } = useI18n();
  const duration = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionId[]>([]);
  const [isDefault, setIsDefault] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const permissions = useMemo(
    () => permissionGroups.flatMap((group) => group.permissions),
    [permissionGroups]
  );
  const allPermissionIds = useMemo(
    () => permissions.map((permission) => permission.id),
    [permissions]
  );

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(false);
      setName(role?.name ?? "");
      setSelectedPermissions(role?.permissions ?? []);
      setIsDefault(role?.isDefault ?? false);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setVisible(true);
        if (!role) nameInputRef.current?.focus();
      }));
      return;
    }

    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => setMounted(false), duration);
  }, [open, role]);

  useEffect(() => {
    if (!open || !role || !permissions.length) return;

    if (role.permissions.includes("*")) {
      setSelectedPermissions(allPermissionIds);
      return;
    }

    setSelectedPermissions(
      permissions
        .filter((permission) =>
          role.permissions.includes(permission.id) ||
          role.permissions.includes(permission.key)
        )
        .map((permission) => permission.id)
    );
  }, [allPermissionIds, open, permissions, role]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!mounted) return null;

  const togglePermission = (permission: PermissionId) => {
    setSelectedPermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission]
    );
  };

  return createPortal(
    <div
      className={`platformRolePopup ${visible ? "visible" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={role ? `${t("rolesEdit")}: ${getRoleLabel(role.name, role.type === "System", t)}` : t("rolesAdd")}
      onMouseDown={onClose}
    >
      <div className="platformRolePopupBackdrop bg-(--backgroundC1)" />
      <form
        className="platformRolePopupPanel"
        onSubmit={(event) => {
          event.preventDefault();
          const normalizedName = name.trim();
          if (!normalizedName) return;
          onSave(normalizedName, selectedPermissions, isDefault);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="platformRolePopupHeader">
          <h3>{t(role ? "rolesEdit" : "rolesAdd")}</h3>
          <p>{t(role ? "rolesEditHelp" : "rolesAddHelp")}</p>
        </div>

        <div className="platformRolePopupBody">
          <label className="platformRoleNameField">
            <span>{t("usersName")}</span>
            <span className="platformRoleNameControl">
              <input
                ref={nameInputRef}
                value={role?.type === "System" ? getRoleLabel(name, true, t) : name}
                onChange={(event) => setName(event.target.value)}
                readOnly={role?.type === "System"}
                maxLength={50}
                required
              />
              <small
                className={`roleTypeBadge roleBadgeTooltip ${(role?.type ?? "Custom").toLowerCase()}`}
                data-tooltip={(role?.type ?? "Custom") === "System" ? t("rolesSystemHelp") : t("rolesCustomHelp")}
                tabIndex={0}
              >
                {t(role?.type === "System" ? "rolesSystem" : "rolesCustom")}
              </small>
            </span>
          </label>

          <div className="platformPermissionsHeader">
            <strong>{t("rolesPermissions")}</strong>
            <div>
              <button
                type="button"
                disabled={isPermissionsLoading || !!permissionsError || !permissions.length}
                onClick={() => setSelectedPermissions(allPermissionIds)}
              >
                {PermissionHandSVG}
                {t("rolesGiveAll")}
              </button>
              <button
                type="button"
                disabled={isPermissionsLoading || !!permissionsError || !permissions.length}
                onClick={() => setSelectedPermissions([])}
              >
                {PermissionClearSVG}
                {t("rolesClear")}
              </button>
            </div>
          </div>

          <div className="platformPermissionList">
            {isPermissionsLoading ? (
              <div className="platformPermissionState">
                <div className="uploadSpinner tiny" />
                <span>{t("rolesPermissionsLoading")}</span>
              </div>
            ) : permissionsError ? (
              <div className="errorBanner platformPermissionState">
                <p>{t("rolesPermissionsFailed")}</p>
                <button type="button" onClick={onRetryPermissions}>{t("usersRetry")}</button>
              </div>
            ) : permissionGroups.length ? (
              permissionGroups.map((group) => (
                <section className="platformPermissionGroup" key={group.name}>
                  <h4>{permissionGroupLabel(group.name, t)}</h4>
                  <div>
                    {group.permissions.map((permission) => {
                      const checked = selectedPermissions.includes(permission.id);
                      return (
                        <label className="platformPermissionItem" key={permission.id}>
                          <span className="platformPermissionIcon">{getPermissionIcon(permission)}</span>
                          <span className="platformPermissionText">
                            <strong>{permissionLabel(permission.key, permission.description, t)}</strong>
                            <small>{permission.key}</small>
                          </span>
                          <input
                            className="quizPopupCheckbox appearance-none rounded-[6px]! p-2.25! border-2 cursor-pointer checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-(--text1) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePermission(permission.id)}
                            aria-label={permissionLabel(permission.key, permission.description, t)}
                          />
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))
            ) : (
              <div className="platformPermissionState">{t("rolesPermissionsEmpty")}</div>
            )}
          </div>

          {role ? (
            <div className="platformDefaultRoleSection">
              <strong>{t("rolesDefault")}</strong>
              <label className="platformDefaultRoleControl">
                <span>
                  <strong>{t("rolesAssignOnRegistration")}</strong>
                  <small>{t("rolesDefaultHelp")}</small>
                </span>
                <input
                  className="quizPopupCheckbox appearance-none rounded-[6px]! p-2.25! border-2 cursor-pointer checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-(--text1) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                  type="checkbox"
                  checked={isDefault}
                  onChange={(event) => setIsDefault(event.target.checked)}
                />
              </label>
            </div>
          ) : null}
        </div>

        {saveError ? (
          <p className="platformRoleMutationError" role="alert">
            {t(role ? "rolesUpdateFailed" : "rolesCreateFailed")}
          </p>
        ) : null}

        <div className="platformRolePopupActions">
          <button type="button" className="cancelBtn platformRoleCancelButton" onClick={onClose}>{t("cancel")}</button>
          <button type="submit" className="saveCaptionsBtn platformRoleSaveButton" disabled={isSaving}>
            {t(isSaving ? (role ? "saving" : "rolesAdding") : role ? "rolesSave" : "rolesAdd")}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

export default function AccessAndRoles() {
  const { t } = useI18n();
  const label = (role: PlatformRole) => getRoleLabel(role.name, role.type === "System", t);
  const [roles, setRoles] = useState<PlatformRole[]>([]);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const roleHeadersRef = useRef(new Headers());
  const queryClient = useQueryClient();
  const { confirm, dialogProps } = useConfirm();
  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId]
  );

  useEffect(() => {
    const storedUser =
      localStorage.getItem("user") ?? sessionStorage.getItem("user");

    if (!storedUser) return;

    try {
      const parsedUser = JSON.parse(storedUser) as { token?: string };
      if (!parsedUser.token) return;

      roleHeadersRef.current = new Headers();
      roleHeadersRef.current.set("Content-Type", "application/json");
      roleHeadersRef.current.set("Authorization", `Bearer ${parsedUser.token}`);
      setToken(parsedUser.token);
    } catch (error) {
      console.error("Failed to parse stored user for permissions fetch:", error);
    }
  }, []);

  const {
    data: rolesResponse,
    isLoading: isRolesLoading,
    error: rolesError,
    refetch: refetchRoles,
  } = useQuery({
    queryKey: ["roles", token],
    queryFn: () =>
      fetchFn<RolesResponse>({
        route: "api/roles",
        options: {
          method: "GET",
          headers: roleHeadersRef.current,
        },
      }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const {
    data: permissionsResponse,
    isLoading: isPermissionsLoading,
    error: permissionsError,
    refetch: refetchPermissions,
  } = useQuery({
    queryKey: ["role-permissions", token],
    queryFn: () =>
      fetchFn<RolePermissionsResponse>({
        route: "api/roles/permissions",
        options: {
          method: "GET",
          headers: roleHeadersRef.current,
        },
      }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const permissionGroups =
    permissionsResponse?.success ? permissionsResponse.groups : [];

  const createRoleMutation = useMutation({
    mutationFn: ({ name, permissions, position }: { name: string; permissions: PermissionId[]; position: number }) =>
      fetchFn<{ success: boolean; role: ApiRole }>({
        route: "api/roles",
        options: {
          method: "POST",
          headers: roleHeadersRef.current,
          body: JSON.stringify({
            name,
            position,
            permissions: permissions.map((id) => ({ id, effect: "allow" as const })),
          }),
        },
      }),
    onSuccess: async () => {
      setIsPopupOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["roles"] }),
        queryClient.invalidateQueries({ queryKey: ["user-permissions"] }),
      ]);
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ roleId, name, permissions, deniedPermissions, position, isDefault }: { roleId: string; name: string; permissions: PermissionId[]; deniedPermissions: PermissionId[]; position: number; isDefault: boolean }) =>
      fetchFn<{ success: boolean; role: ApiRole }>({
        route: `api/roles/${roleId}`,
        options: {
          method: "PATCH",
          headers: roleHeadersRef.current,
          body: JSON.stringify({
            name,
            position,
            is_default: isDefault,
            permissions: [...permissions.map((id) => ({ id, effect: "allow" as const })), ...deniedPermissions.filter(id => !permissions.includes(id)).map(id => ({ id, effect: "deny" as const }))],
          }),
        },
      }),
    onSuccess: async () => {
      setIsPopupOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["roles"] }),
        queryClient.invalidateQueries({ queryKey: ["user-permissions"] }),
      ]);
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (roleId: string) =>
      fetchFn<{ success: boolean }>({
        route: `api/roles/${roleId}`,
        options: {
          method: "DELETE",
          headers: roleHeadersRef.current,
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["roles"] }),
        queryClient.invalidateQueries({ queryKey: ["user-permissions"] }),
      ]);
    },
  });

  useEffect(() => {
    if (!rolesResponse?.success) return;

    setRoles(rolesResponse.roles.map<PlatformRole>((role) => ({
      id: role.id,
      name: role.name,
      type: role.is_system ? "System" : "Custom",
      users: role.member_count,
      deniedPermissions: role.permissions.filter(permission => permission.effect === "deny").map(permission => String(permission.id)),
      permissions: role.is_owner
        ? ["*"]
        : role.permissions
            .filter((permission) => permission.effect === "allow")
            .map((permission) => String(permission.id)),
      position: role.position,
      isDefault: role.is_default,
      canUpdate: role.can_update,
      canDelete: role.can_delete,
    })).sort((firstRole, secondRole) => firstRole.position - secondRole.position));
  }, [rolesResponse]);

  const calculateRolePosition = (permissions: PermissionId[], excludedRoleId?: string) => {
    const totalPermissionCount = permissionGroups.reduce(
      (total, group) => total + group.permissions.length,
      0
    );
    const selectedPermissionCount = permissions.length;

    return roles.filter((role) => {
      if (role.id === excludedRoleId) return false;
      const rolePermissionCount = role.permissions.includes("*")
        ? totalPermissionCount
        : role.permissions.length;
      return rolePermissionCount >= selectedPermissionCount;
    }).length;
  };

  const openAddRole = () => {
    createRoleMutation.reset();
    setSelectedRoleId(null);
    setIsPopupOpen(true);
  };

  const openEditRole = (role: PlatformRole) => {
    updateRoleMutation.reset();
    setSelectedRoleId(role.id);
    setIsPopupOpen(true);
  };

  const deleteRole = async (role: PlatformRole) => {
    const shouldDelete = await confirm({
      title: t("rolesDeleteTitle"),
      message: t("rolesDeleteMessage", { name: label(role) }),
      yesText: t("delete"),
      noText: t("cancel"),
    });
    if (shouldDelete) deleteRoleMutation.mutate(role.id);
  };

  return (
    <>
      <PlatformSettingsHeader activePage="access" />
      <ConfirmDialog {...dialogProps} />

      <div className="accessRolesLayout">
        <section className="platformSettingsCard rolesCard">
          <div className="rolesCardHeader">
            <span><h2>{t("usersRoles")}</h2><p>{t("rolesManageHelp")}</p></span>
            <button type="button" className="addRoleButton" onClick={openAddRole}>
              {RoleAddSVG}
              {t("rolesAdd")}
            </button>
          </div>

          {deleteRoleMutation.error ? (
            <p className="rolesMutationError" role="alert">
              {t("rolesDeleteFailed")}
            </p>
          ) : null}

          <div className="rolesTable" role="table" aria-label={t("rolesTableLabel")}>
            <div className="rolesTableHeader" role="row">
              <span role="columnheader">{t("rolesName")}</span>
              <span role="columnheader">{t("rolesUsers")}</span>
              <span role="columnheader">{t("usersActions")}</span>
            </div>
            {isRolesLoading ? (
              <div className="rolesTableState">
                <div className="uploadSpinner tiny" />
                <span>{t("rolesLoading")}</span>
              </div>
            ) : rolesError ? (
              <div className="errorBanner rolesTableState">
                <p>{t("rolesLoadFailed")}</p>
                <button type="button" onClick={() => void refetchRoles()}>{t("usersRetry")}</button>
              </div>
            ) : roles.length ? roles.map((role) => (
              <div className="rolesTableRow" role="row" key={role.id}>
                <span className="roleNameCell" role="cell">
                  <strong>{label(role)}</strong>
                  <small
                    className={`roleTypeBadge roleBadgeTooltip ${role.type.toLowerCase()}`}
                    data-tooltip={role.type === "System" ? t("rolesSystemHelp") : t("rolesCustomHelp")}
                    tabIndex={0}
                  >{t(role.type === "System" ? "rolesSystem" : "rolesCustom")}</small>
                  {role.isDefault ? (
                    <small
                      className="roleTypeBadge roleBadgeTooltip default"
                      data-tooltip={t("rolesDefaultHelp")}
                      tabIndex={0}
                    >{t("rolesDefaultBadge")}</small>
                  ) : null}
                </span>
                <strong className="roleUsersCell" role="cell">{role.users}</strong>
                <span className="roleActionsCell" role="cell">
                  <button type="button" className="edit" disabled={!role.canUpdate || updateRoleMutation.isPending} onClick={() => openEditRole(role)} aria-label={`${t("rolesEdit")}: ${label(role)}`}>
                    {RoleWrenchSVG}
                  </button>
                  <button type="button" className="delete" disabled={!role.canDelete || deleteRoleMutation.isPending} onClick={() => void deleteRole(role)} aria-label={`${t("delete")}: ${label(role)}`}>
                    {RoleDeleteSVG}
                  </button>
                </span>
              </div>
            )) : (
              <div className="rolesTableState">{t("rolesEmpty")}</div>
            )}
          </div>
          <p className="rolesTotal">{t("rolesTotal", { count: roles.length })}</p>
        </section>

        <RoleOverview roles={roles} />
      </div>

      <RolePopup
        open={isPopupOpen}
        role={selectedRole}
        permissionGroups={permissionGroups}
        isPermissionsLoading={isPermissionsLoading}
        permissionsError={permissionsError}
        onRetryPermissions={() => void refetchPermissions()}
        isSaving={selectedRole ? updateRoleMutation.isPending : createRoleMutation.isPending}
        saveError={selectedRole ? updateRoleMutation.error : createRoleMutation.error}
        onClose={() => {
          createRoleMutation.reset();
          updateRoleMutation.reset();
          setIsPopupOpen(false);
        }}
        onSave={(name, selectedPermissions, isDefault) => {
          if (selectedRole) {
            updateRoleMutation.mutate({
              roleId: selectedRole.id,
              deniedPermissions: selectedRole.deniedPermissions,
              name,
              permissions: selectedPermissions,
              position: calculateRolePosition(selectedPermissions, selectedRole.id),
              isDefault,
            });
            return;
          } else {
            createRoleMutation.mutate({
              name,
              permissions: selectedPermissions,
              position: calculateRolePosition(selectedPermissions),
            });
            return;
          }
        }}
      />
    </>
  );
}
