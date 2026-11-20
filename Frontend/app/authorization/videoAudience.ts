export interface VideoCardAccess {
  can_watch?: boolean;
  audience_mode?: 'everyone' | 'selected_roles' | null;
}

export function isRoleLocked(video?: VideoCardAccess | null) {
  return video?.audience_mode === 'selected_roles' && video.can_watch === false;
}

export type RoleRestrictionDraft = {
  enabled: boolean;
  roleIds: string[];
  hideBanner: boolean;
};

export type VideoAudience = {
  audience_mode?: 'everyone' | 'selected_roles' | null;
  allowed_role_ids?: string[];
  show_locked_card?: boolean;
};

export function readAudience(video?: VideoAudience): RoleRestrictionDraft {
  const enabled = video?.audience_mode === 'selected_roles';
  return {
    enabled,
    roleIds: enabled ? video.allowed_role_ids ?? [] : [],
    hideBanner: !enabled || video.show_locked_card === false,
  };
}

export function audiencePayload(draft: RoleRestrictionDraft) {
  return {
    audience_mode: draft.enabled ? 'selected_roles' : 'everyone',
    allowed_role_ids: draft.enabled ? [...draft.roleIds].sort() : [],
    show_locked_card: draft.enabled && !draft.hideBanner,
  };
}
