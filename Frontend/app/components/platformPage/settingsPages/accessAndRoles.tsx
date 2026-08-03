import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { ConfirmDialog } from "~/components/confirmPopup/confirmDialog";
import { useConfirm } from "~/components/confirmPopup/useConfirm";
import {
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
} from "~/constants";
import PlatformSettingsHeader from "./platformSettingsHeader";

type PermissionId =
  | "view-content"
  | "manage-comments"
  | "edit-profile"
  | "create-content"
  | "manage-content"
  | "manage-users"
  | "manage-settings"
  | "view-analytics";

type PlatformRole = {
  id: string;
  name: string;
  type: "System" | "Custom";
  users: number;
  permissions: PermissionId[];
};

const permissions: Array<{
  id: PermissionId;
  title: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { id: "view-content", title: "View videos & playlists", description: "Can browse and watch content", icon: PermissionEyeSVG },
  { id: "manage-comments", title: "View, edit and delete comments", description: "Can create, edit and delete their own comments", icon: PermissionChatSVG },
  { id: "edit-profile", title: "Edit their profile", description: "Can edit and update their profile", icon: PermissionPaletteSVG },
  { id: "create-content", title: "Create videos & playlists", description: "Can have a channel, create videos and playlists", icon: PermissionAddCircleSVG },
  { id: "manage-content", title: "Edit/Delete videos & playlists", description: "Can edit/delete videos and playlists they uploaded", icon: PermissionEditSVG },
  { id: "manage-users", title: "Manage users", description: "Can add, edit and remove users", icon: PermissionUsersSVG },
  { id: "manage-settings", title: "Manage platform settings", description: "Can access and modify platform settings", icon: PermissionSettingsSVG },
  { id: "view-analytics", title: "View analytics", description: "Can view platform analytics and create reports", icon: PermissionAnalyticsSVG },
];

const allPermissionIds = permissions.map(({ id }) => id);
const initialRoles: PlatformRole[] = [
  { id: "owner", name: "Owner", type: "System", users: 1, permissions: allPermissionIds },
  { id: "administrator", name: "Administrator", type: "System", users: 3, permissions: allPermissionIds },
  { id: "content-manager", name: "Content Manager", type: "Custom", users: 2, permissions: ["view-content", "manage-comments", "create-content", "manage-content", "view-analytics"] },
  { id: "editor", name: "Editor", type: "Custom", users: 6, permissions: ["view-content", "manage-comments", "edit-profile", "create-content", "manage-content"] },
  { id: "viewer", name: "Viewer", type: "System", users: 408, permissions: ["view-content", "manage-comments", "edit-profile"] },
];
const chartColors = ["var(--analyticsChart1)", "var(--analyticsChart2)", "var(--analyticsChart3)", "var(--analyticsChart4)", "var(--analyticsChart5)"];

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
            <PieChart><Pie data={roles} dataKey="users" nameKey="name" cx="50%" cy="50%" innerRadius="62%" outerRadius="92%" paddingAngle={1} cornerRadius={3} stroke="var(--background1)" strokeWidth={2} animationDuration={500} onMouseEnter={(_, index) => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)}>
              {roles.map((role, index) => <Cell key={role.id} fill={chartColors[index % chartColors.length]} />)}
            </Pie></PieChart>
          </ResponsiveContainer>
          <div className="roleOverviewCenter"><strong>{activeRole?.users ?? totalUsers}</strong><span>{activeRole?.name ?? "Total users"}</span></div>
        </div>
        <div className="roleOverviewLegend">
          {roles.map((role, index) => {
            const percentage = totalUsers > 0 ? ((role.users / totalUsers) * 100).toFixed(1) : "0.0";
            return <div className="roleOverviewLegendItem" key={role.id}><i style={{ backgroundColor: chartColors[index % chartColors.length] }} /><span><strong>{role.name}</strong><small>{role.users} ({percentage}%)</small></span></div>;
          })}
        </div>
      </div>
    </section>
  );
}

function RolePopup({ open, role, onClose, onSave }: { open: boolean; role: PlatformRole | null; onClose: () => void; onSave: (name: string, selectedPermissions: PermissionId[]) => void }) {
  const duration = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionId[]>([]);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current); }, []);
  useEffect(() => {
    if (open) {
      setMounted(true); setVisible(false); setName(role?.name ?? ""); setSelectedPermissions(role?.permissions ?? []);
      requestAnimationFrame(() => requestAnimationFrame(() => { setVisible(true); if (!role) nameInputRef.current?.focus(); }));
      return;
    }
    setVisible(false); closeTimerRef.current = window.setTimeout(() => setMounted(false), duration);
  }, [open, role]);
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKeyDown); return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);
  if (!mounted) return null;
  const togglePermission = (permission: PermissionId) => setSelectedPermissions((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
  return createPortal(
    <div className={`platformRolePopup ${visible ? "visible" : ""}`} role="dialog" aria-modal="true" aria-label={role ? `Edit ${role.name} role` : "Add role"} onMouseDown={onClose}>
      <div className="platformRolePopupBackdrop bg-(--backgroundC1)" />
      <form className="platformRolePopupPanel" onSubmit={(event) => { event.preventDefault(); const normalizedName = name.trim(); if (normalizedName) onSave(normalizedName, selectedPermissions); }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="platformRolePopupHeader"><h3>{role ? "Edit role" : "Add role"}</h3><p>{role ? "Edit user permissions for the selected role" : "Create a role and choose its permissions"}</p></div>
        <div className="platformRolePopupBody">
          <label className="platformRoleNameField"><span>Name</span><span className="platformRoleNameControl"><input ref={nameInputRef} value={name} onChange={(event) => setName(event.target.value)} readOnly={role?.type === "System"} maxLength={50} required /><small className={`roleTypeBadge ${(role?.type ?? "Custom").toLowerCase()}`}>{role?.type ?? "Custom"}</small></span></label>
          <div className="platformPermissionsHeader"><strong>Permissions</strong><div>
            <button type="button" onClick={() => setSelectedPermissions(allPermissionIds)}>{PermissionHandSVG}Give all permissions</button>
            <button type="button" onClick={() => setSelectedPermissions([])}>{PermissionClearSVG}Clear permissions</button>
          </div></div>
          <div className="platformPermissionList">{permissions.map((permission) => {
            const checked = selectedPermissions.includes(permission.id);
            return <label className="platformPermissionItem" key={permission.id}><span className="platformPermissionIcon">{permission.icon}</span><span className="platformPermissionText"><strong>{permission.title}</strong><small>{permission.description}</small></span><input className="quizPopupCheckbox appearance-none rounded-[6px]! p-2.25! border-2 cursor-pointer checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-(--text1) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2" type="checkbox" checked={checked} onChange={() => togglePermission(permission.id)} aria-label={permission.title} /></label>;
          })}</div>
        </div>
        <div className="platformRolePopupActions"><button type="button" className="cancelBtn platformRoleCancelButton" onClick={onClose}>Cancel</button><button type="submit" className="saveCaptionsBtn platformRoleSaveButton">{role ? "Save role" : "Add role"}</button></div>
      </form>
    </div>, document.body
  );
}

export default function AccessAndRoles() {
  const [roles, setRoles] = useState(initialRoles);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const { confirm, dialogProps } = useConfirm();
  const selectedRole = useMemo(() => roles.find((role) => role.id === selectedRoleId) ?? null, [roles, selectedRoleId]);
  const openAddRole = () => { setSelectedRoleId(null); setIsPopupOpen(true); };
  const openEditRole = (role: PlatformRole) => { setSelectedRoleId(role.id); setIsPopupOpen(true); };
  const deleteRole = async (role: PlatformRole) => {
    const shouldDelete = await confirm({ title: "Delete role?", message: `Are you sure you want to delete the ${role.name} role?`, yesText: "Delete", noText: "Cancel" });
    if (shouldDelete) setRoles((current) => current.filter((item) => item.id !== role.id));
  };
  return <>
    <PlatformSettingsHeader activePage="access" /><ConfirmDialog {...dialogProps} />
    <div className="accessRolesLayout">
      <section className="platformSettingsCard rolesCard">
        <div className="rolesCardHeader"><span><h2>Roles</h2><p>Manage user roles and their permissions</p></span><button type="button" className="addRoleButton" onClick={openAddRole}>{RoleAddSVG}Add role</button></div>
        <div className="rolesTable" role="table" aria-label="Platform roles">
          <div className="rolesTableHeader" role="row"><span role="columnheader">Role name</span><span role="columnheader">Users</span><span role="columnheader">Actions</span></div>
          {roles.map((role) => <div className="rolesTableRow" role="row" key={role.id}>
            <span className="roleNameCell" role="cell"><strong>{role.name}</strong><small className={`roleTypeBadge ${role.type.toLowerCase()}`}>{role.type}</small></span>
            <strong className="roleUsersCell" role="cell">{role.users}</strong>
            <span className="roleActionsCell" role="cell"><button type="button" className="edit" onClick={() => openEditRole(role)} aria-label={`Edit ${role.name}`}>{RoleWrenchSVG}</button><button type="button" className="delete" onClick={() => void deleteRole(role)} aria-label={`Delete ${role.name}`}>{RoleDeleteSVG}</button></span>
          </div>)}
        </div><p className="rolesTotal">Total roles: {roles.length}</p>
      </section>
      <RoleOverview roles={roles} />
    </div>
    <RolePopup open={isPopupOpen} role={selectedRole} onClose={() => setIsPopupOpen(false)} onSave={(name, selectedPermissions) => {
      if (selectedRole) setRoles((current) => current.map((role) => role.id === selectedRole.id ? { ...role, name, permissions: selectedPermissions } : role));
      else setRoles((current) => [...current, { id: `role-${Date.now()}`, name, type: "Custom", users: 0, permissions: selectedPermissions }]);
      setIsPopupOpen(false);
    }} />
  </>;
}
