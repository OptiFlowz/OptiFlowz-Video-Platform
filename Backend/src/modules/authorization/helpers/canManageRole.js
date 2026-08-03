export function canManageRole(
  actorAuthorization,
  targetRole,
) {
  if (actorAuthorization.isOwner) {
    return !targetRole.is_owner;
  }

  return (
    !targetRole.is_owner
    && targetRole.position
      > actorAuthorization.highestRolePosition
  );
}

export function canUpdateRole(actorAuthorization, targetRole) {
  if (targetRole.is_owner) {
    return false;
  }

  if (actorAuthorization.isOwner) {
    return true;
  }

  return (
    !targetRole.is_system
    && canManageRole(actorAuthorization, targetRole)
  );
}

export function canDeleteRole(actorAuthorization, targetRole) {
  return (
    !targetRole.is_system
    && !targetRole.is_default
    && !targetRole.is_owner
    && canManageRole(actorAuthorization, targetRole)
  );
}
