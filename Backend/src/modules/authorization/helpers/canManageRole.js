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