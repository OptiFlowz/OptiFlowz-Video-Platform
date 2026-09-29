import { readFile } from 'node:fs/promises';

export const livePermissionsMigration = await readFile(new URL('../../src/database/migrations/1790640000001_add-live-stream-permissions.sql', import.meta.url), 'utf8');

export async function prepareLivePermissions(client, uploaders = []) {
  await client.query(`CREATE TEMP TABLE permissions (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      key text UNIQUE NOT NULL, description text NOT NULL, group_name text NOT NULL, resource_type text,
      risk_level text NOT NULL CHECK (risk_level IN ('normal','sensitive','dangerous')));
    CREATE TEMP TABLE roles (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text UNIQUE, position integer, is_owner boolean DEFAULT false);
    CREATE TEMP TABLE role_permissions (role_id bigint REFERENCES pg_temp.roles(id) ON DELETE CASCADE,
      permission_id bigint REFERENCES pg_temp.permissions(id) ON DELETE CASCADE, effect text CHECK(effect IN ('allow','deny')), PRIMARY KEY(role_id,permission_id));
    CREATE TEMP TABLE user_roles (user_id uuid REFERENCES pg_temp.users(id), role_id bigint REFERENCES pg_temp.roles(id),
      expires_at timestamptz, PRIMARY KEY(user_id,role_id));
    INSERT INTO pg_temp.roles(name,position,is_owner) VALUES
      ('Owner',0,true),('Administrator',1,false),('Moderator',2,false),('Uploader',3,false),('Viewer',4,false);`);
  // Resolve every unqualified migration table to a connection-local fixture.
  await client.query('SET search_path TO pg_temp');
  await client.query(livePermissionsMigration.split('-- Down Migration')[0]);
  for (const user of uploaders) {
    await client.query("INSERT INTO pg_temp.user_roles(user_id,role_id) SELECT $1,id FROM pg_temp.roles WHERE name='Uploader'", [user]);
  }
  await client.query('SET search_path TO pg_temp, public');
}
