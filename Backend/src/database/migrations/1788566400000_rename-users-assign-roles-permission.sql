-- Up Migration

UPDATE permissions
SET key = 'users.assign_roles', group_name = 'Users'
WHERE key = 'members.assign_roles';

-- Down Migration

UPDATE permissions
SET key = 'members.assign_roles', group_name = 'Members'
WHERE key = 'users.assign_roles';
