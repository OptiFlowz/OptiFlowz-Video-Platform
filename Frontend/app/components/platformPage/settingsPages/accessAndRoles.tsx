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
  position: number;
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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const totalUsers = roles.reduce((total, role) => total + role.users, 0);
  const activeRole = activeIndex === null ? null : roles[activeIndex];

  return (
    <section className="platformSettingsCard roleOverviewCard">
      <h2>Role overview</h2>
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
            <span>{activeRole?.name ?? "Total users"}</span>
          </div>
        </div>

        <div className="roleOverviewLegend">
          {roles.map((role, index) => {
            const percentage = totalUsers > 0 ? ((role.users / totalUsers) * 100).toFixed(1) : "0.0";
            return (
              <div className="roleOverviewLegendItem" key={role.id}>
                <i style={{ backgroundColor: chartColors[index % chartColors.length] }} />
                <span><strong>{role.name}</strong><small>{role.users} ({percentage}%)</small></span>
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
  onSave: (name: string, selectedPermissions: PermissionId[]) => void;
}) {
  const duration = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionId[]>([]);
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
      aria-label={role ? `Edit ${role.name} role` : "Add role"}
      onMouseDown={onClose}
    >
      <div className="platformRolePopupBackdrop bg-(--backgroundC1)" />
      <form
        className="platformRolePopupPanel"
        onSubmit={(event) => {
          event.preventDefault();
          const normalizedName = name.trim();
          if (!normalizedName) return;
          onSave(normalizedName, selectedPermissions);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="platformRolePopupHeader">
          <h3>{role ? "Edit role" : "Add role"}</h3>
          <p>{role ? "Edit user permissions for the selected role" : "Create a role and choose its permissions"}</p>
        </div>

        <div className="platformRolePopupBody">
          <label className="platformRoleNameField">
            <span>Name</span>
            <span className="platformRoleNameControl">
              <input
                ref={nameInputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                readOnly={role?.type === "System"}
                maxLength={50}
                required
              />
              <small className={`roleTypeBadge ${(role?.type ?? "Custom").toLowerCase()}`}>
                {role?.type ?? "Custom"}
              </small>
            </span>
          </label>

          <div className="platformPermissionsHeader">
            <strong>Permissions</strong>
            <div>
              <button
                type="button"
                disabled={isPermissionsLoading || !!permissionsError || !permissions.length}
                onClick={() => setSelectedPermissions(allPermissionIds)}
              >
                {PermissionHandSVG}
                Give all permissions
              </button>
              <button
                type="button"
                disabled={isPermissionsLoading || !!permissionsError || !permissions.length}
                onClick={() => setSelectedPermissions([])}
              >
                {PermissionClearSVG}
                Clear permissions
              </button>
            </div>
          </div>

          <div className="platformPermissionList">
            {isPermissionsLoading ? (
              <div className="platformPermissionState">
                <div className="uploadSpinner tiny" />
                <span>Loading permissions...</span>
              </div>
            ) : permissionsError ? (
              <div className="errorBanner platformPermissionState">
                <p>{permissionsError.message || "Failed to load permissions."}</p>
                <button type="button" onClick={onRetryPermissions}>Retry</button>
              </div>
            ) : permissionGroups.length ? (
              permissionGroups.map((group) => (
                <section className="platformPermissionGroup" key={group.name}>
                  <h4>{group.name}</h4>
                  <div>
                    {group.permissions.map((permission) => {
                      const checked = selectedPermissions.includes(permission.id);
                      return (
                        <label className="platformPermissionItem" key={permission.id}>
                          <span className="platformPermissionIcon">{getPermissionIcon(permission)}</span>
                          <span className="platformPermissionText">
                            <strong>{permission.description}</strong>
                            <small>{permission.key}</small>
                          </span>
                          <input
                            className="quizPopupCheckbox appearance-none rounded-[6px]! p-2.25! border-2 cursor-pointer checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-(--text1) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePermission(permission.id)}
                            aria-label={permission.description}
                          />
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))
            ) : (
              <div className="platformPermissionState">No permissions available.</div>
            )}
          </div>
        </div>

        {saveError ? (
          <p className="platformRoleMutationError" role="alert">
            {saveError.message || (role ? "Failed to update role." : "Failed to create role.")}
          </p>
        ) : null}

        <div className="platformRolePopupActions">
          <button type="button" className="cancelBtn platformRoleCancelButton" onClick={onClose}>Cancel</button>
          <button type="submit" className="saveCaptionsBtn platformRoleSaveButton" disabled={isSaving}>
            {isSaving ? (role ? "Saving..." : "Adding...") : role ? "Save role" : "Add role"}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

export default function AccessAndRoles() {
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
    queryKey: ["roles"],
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
    queryKey: ["role-permissions"],
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
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ roleId, name, permissions, position }: { roleId: string; name: string; permissions: PermissionId[]; position: number }) =>
      fetchFn<{ success: boolean; role: ApiRole }>({
        route: `api/roles/${roleId}`,
        options: {
          method: "PATCH",
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
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
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
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
  });

  useEffect(() => {
    if (!rolesResponse?.success) return;

    setRoles(rolesResponse.roles.map<PlatformRole>((role) => ({
      id: role.id,
      name: role.name,
      type: role.is_system ? "System" : "Custom",
      users: role.member_count,
      permissions: role.is_owner
        ? ["*"]
        : role.permissions
            .filter((permission) => permission.effect === "allow")
            .map((permission) => String(permission.id)),
      position: role.position,
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
      title: "Delete role?",
      message: `Are you sure you want to delete the ${role.name} role?`,
      yesText: "Delete",
      noText: "Cancel",
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
            <span><h2>Roles</h2><p>Manage user roles and their permissions</p></span>
            <button type="button" className="addRoleButton" onClick={openAddRole}>
              {RoleAddSVG}
              Add role
            </button>
          </div>

          {deleteRoleMutation.error ? (
            <p className="rolesMutationError" role="alert">
              {deleteRoleMutation.error.message || "Failed to delete role."}
            </p>
          ) : null}

          <div className="rolesTable" role="table" aria-label="Platform roles">
            <div className="rolesTableHeader" role="row">
              <span role="columnheader">Role name</span>
              <span role="columnheader">Users</span>
              <span role="columnheader">Actions</span>
            </div>
            {isRolesLoading ? (
              <div className="rolesTableState">
                <div className="uploadSpinner tiny" />
                <span>Loading roles...</span>
              </div>
            ) : rolesError ? (
              <div className="errorBanner rolesTableState">
                <p>{rolesError.message || "Failed to load roles."}</p>
                <button type="button" onClick={() => void refetchRoles()}>Retry</button>
              </div>
            ) : roles.length ? roles.map((role) => (
              <div className="rolesTableRow" role="row" key={role.id}>
                <span className="roleNameCell" role="cell">
                  <strong>{role.name}</strong>
                  <small className={`roleTypeBadge ${role.type.toLowerCase()}`}>{role.type}</small>
                </span>
                <strong className="roleUsersCell" role="cell">{role.users}</strong>
                <span className="roleActionsCell" role="cell">
                  <button type="button" className="edit" disabled={!role.canUpdate || updateRoleMutation.isPending} onClick={() => openEditRole(role)} aria-label={`Edit ${role.name}`}>
                    {RoleWrenchSVG}
                  </button>
                  <button type="button" className="delete" disabled={!role.canDelete || deleteRoleMutation.isPending} onClick={() => void deleteRole(role)} aria-label={`Delete ${role.name}`}>
                    {RoleDeleteSVG}
                  </button>
                </span>
              </div>
            )) : (
              <div className="rolesTableState">No roles available.</div>
            )}
          </div>
          <p className="rolesTotal">Total roles: {roles.length}</p>
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
        onSave={(name, selectedPermissions) => {
          if (selectedRole) {
            updateRoleMutation.mutate({
              roleId: selectedRole.id,
              name,
              permissions: selectedPermissions,
              position: calculateRolePosition(selectedPermissions, selectedRole.id),
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
