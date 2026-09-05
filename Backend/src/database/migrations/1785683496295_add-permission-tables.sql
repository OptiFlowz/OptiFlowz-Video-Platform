-- Up Migration

CREATE TABLE permissions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key text NOT NULL UNIQUE,
    description text NOT NULL,
    group_name text NOT NULL,
    resource_type text,
    risk_level text NOT NULL DEFAULT 'normal'
        CHECK (risk_level IN ('normal', 'sensitive', 'dangerous'))
);

CREATE TABLE roles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE,
    description text,
    color text,
    position integer NOT NULL DEFAULT 0,
    is_system boolean NOT NULL DEFAULT false,
    is_default boolean NOT NULL DEFAULT false,
    is_owner boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
    role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id bigint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    effect text NOT NULL CHECK (effect IN ('allow', 'deny')),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    PRIMARY KEY (user_id, role_id)
);

INSERT INTO permissions
    (key, description, group_name, resource_type, risk_level)
VALUES
    ('roles.manage',
     'Create, update and delete manageable roles',
     'Roles', NULL, 'dangerous'),

    ('users.assign_roles',
     'Assign manageable roles to users',
     'Users', NULL, 'dangerous'),

    ('users.search',
     'Search users and view their role assignments',
     'Users', NULL, 'sensitive'),

    ('videos.create',
     'Upload videos',
     'Videos', 'video', 'normal'),

    ('videos.update_own',
     'Update videos uploaded by the user',
     'Videos', 'video', 'normal'),

    ('videos.update_any',
     'Update any video',
     'Videos', 'video', 'dangerous'),

    ('videos.delete_own',
     'Delete videos uploaded by the user',
     'Videos', 'video', 'sensitive'),

    ('videos.delete_any',
     'Delete any video',
     'Videos', 'video', 'dangerous'),

    ('videos.library.read',
     'Read the user video library and recommendations',
     'Videos', 'video', 'normal'),

    ('videos.progress.update',
     'Record video watch progress',
     'Videos', 'video', 'normal'),

    ('videos.react',
     'Like or dislike videos',
     'Videos', 'video', 'normal'),

    ('playlists.create',
     'Create playlists',
     'Playlists', 'playlist', 'normal'),

    ('playlists.update_own',
     'Update playlists created by the user',
     'Playlists', 'playlist', 'normal'),

    ('playlists.update_any',
     'Update any playlist',
     'Playlists', 'playlist', 'dangerous'),

    ('playlists.delete_own',
     'Delete playlists created by the user',
     'Playlists', 'playlist', 'sensitive'),

    ('playlists.delete_any',
     'Delete any playlist',
     'Playlists', 'playlist', 'dangerous'),

    ('playlists.library.read',
     'Read the user saved-playlist library',
     'Playlists', 'playlist', 'normal'),

    ('playlists.save',
     'Save or unsave playlists',
     'Playlists', 'playlist', 'normal'),

    ('quizzes.create',
     'Create quizzes',
     'Quizzes', 'quiz', 'normal'),

    ('quizzes.manage_own',
     'Manage quizzes created by the user',
     'Quizzes', 'quiz', 'normal'),

    ('quizzes.manage_any',
     'Manage any quiz',
     'Quizzes', 'quiz', 'dangerous'),

    ('quizzes.participate',
     'Start, answer and submit quiz attempts',
     'Quizzes', 'quiz', 'normal'),

    ('quizzes.certificates',
     'View and generate earned quiz certificates',
     'Quizzes', 'quiz', 'normal'),

    ('comments.create',
     'Post comments',
     'Comments', 'comment', 'normal'),

    ('comments.edit_own',
     'Edit own comments',
     'Comments', 'comment', 'normal'),

    ('comments.delete_own',
     'Delete own comments',
     'Comments', 'comment', 'normal'),

    ('comments.moderate',
     'Delete or moderate any comment',
     'Comments', 'comment', 'sensitive'),

    ('comments.react',
     'Like or dislike comments',
     'Comments', 'comment', 'normal'),

    ('people.manage',
     'Create, update and delete people',
     'People', 'person', 'sensitive'),

    ('analytics.video_own.read',
     'Read analytics for own videos',
     'Analytics', 'video', 'sensitive'),

    ('analytics.video_any.read',
     'Read analytics for any video',
     'Analytics', 'video', 'sensitive'),

    ('analytics.channel_own.read',
     'Read analytics for own channel',
     'Analytics', 'channel', 'sensitive'),

    ('analytics.channel_any.read',
     'Read analytics for any channel',
     'Analytics', 'channel', 'sensitive'),

    ('analytics.platform.read',
     'Read platform-wide analytics',
     'Analytics', NULL, 'dangerous'),

    ('reports.analytics.export',
     'Export analytics reports',
     'Reports', NULL, 'sensitive');

INSERT INTO roles
    (name, description, position, is_system, is_default, is_owner)
VALUES
    ('Viewer', 'Default registered user', 4, true, true, false),
    ('Uploader', 'Can create and manage own content', 3, true, false, false),
    ('Moderator', 'Can moderate community content', 2, true, false, false),
    ('Administrator', 'Platform administrator', 1, true, false, false),
    ('Owner', 'Protected platform owner', 0, true, false, true);

ALTER TABLE roles
ADD CONSTRAINT roles_position_non_negative
CHECK (position >= 0);

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'Viewer'
  AND p.key IN (
      'comments.create',
      'comments.edit_own',
      'comments.delete_own',
      'comments.react',
      'videos.library.read',
      'videos.progress.update',
      'videos.react',
      'playlists.library.read',
      'playlists.save',
      'quizzes.participate',
      'quizzes.certificates'
  )
ON CONFLICT (role_id, permission_id)
DO UPDATE SET effect = EXCLUDED.effect;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'Uploader'
  AND p.key IN (
      'videos.create',
      'videos.update_own',
      'videos.delete_own',
      'playlists.create',
      'playlists.update_own',
      'quizzes.create',
      'quizzes.manage_own',
      'analytics.video_own.read',
      'analytics.channel_own.read'
  )
ON CONFLICT (role_id, permission_id)
DO UPDATE SET effect = EXCLUDED.effect;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'Moderator'
  AND p.key IN (
      'comments.create',
      'comments.edit_own',
      'comments.delete_own',
      'comments.moderate'
  )
ON CONFLICT (role_id, permission_id)
DO UPDATE SET effect = EXCLUDED.effect;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'Administrator'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET effect = EXCLUDED.effect;

-- Preserve baseline member access for every existing account.
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
CROSS JOIN roles r
WHERE r.is_default = true
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Preserve legacy elevated roles while routes move to permission checks.
INSERT INTO user_roles (user_id, role_id)
SELECT
  u.id,
  r.id
FROM users u
JOIN roles r
  ON r.name = CASE lower(u.role)
    WHEN 'uploader' THEN 'Uploader'
    WHEN 'moderator' THEN 'Moderator'
    WHEN 'admin' THEN 'Administrator'
    WHEN 'owner' THEN 'Owner'
    ELSE NULL
  END
ON CONFLICT (user_id, role_id) DO NOTHING;

ALTER TABLE users
ADD COLUMN authz_version integer NOT NULL DEFAULT 1;

ALTER TABLE users
ADD COLUMN status text NOT NULL DEFAULT 'active'
CHECK (status IN ('active', 'suspended', 'disabled'));

CREATE INDEX user_roles_user_active_idx
ON user_roles (user_id, expires_at);

CREATE INDEX user_roles_role_idx
ON user_roles (role_id);

CREATE INDEX role_permissions_permission_idx
ON role_permissions (permission_id);

-- Down Migration

DROP INDEX role_permissions_permission_idx;
DROP INDEX user_roles_role_idx;
DROP INDEX user_roles_user_active_idx;

ALTER TABLE users
DROP COLUMN status;

ALTER TABLE users
DROP COLUMN authz_version;

DROP TABLE user_roles;
DROP TABLE role_permissions;
DROP TABLE roles;
DROP TABLE permissions;
