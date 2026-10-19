import { readFile } from 'node:fs/promises';

// Use real authorization tables and the real grants migration in isolated fixtures.
export async function installQuizPermissions(database, { schema = 'pg_temp', defaultRole = 'Uploader' } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid test schema');
  await database.query(`
    CREATE TABLE ${schema}.permissions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key text UNIQUE NOT NULL,
      description text, group_name text, resource_type text, risk_level text
    );
    CREATE TABLE ${schema}.roles (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text UNIQUE,
      position integer DEFAULT 0, is_owner boolean DEFAULT false
    );
    CREATE TABLE ${schema}.role_permissions (
      role_id bigint REFERENCES ${schema}.roles(id), permission_id bigint REFERENCES ${schema}.permissions(id) ON DELETE CASCADE,
      effect text NOT NULL, PRIMARY KEY(role_id,permission_id)
    );
    CREATE TABLE ${schema}.user_roles (
      user_id uuid REFERENCES ${schema}.users(id), role_id bigint REFERENCES ${schema}.roles(id),
      expires_at timestamptz, PRIMARY KEY(user_id,role_id)
    );
    INSERT INTO ${schema}.roles(name,position,is_owner) VALUES
      ('Viewer',4,false),('Uploader',3,false),('Administrator',1,false),('Owner',0,true);
  `);
  const sql = await readFile(new URL('../../src/database/migrations/1792368000000_add-quizzes-engine-permissions.sql', import.meta.url), 'utf8');
  await database.query(sql.split('-- Down Migration')[0]);
  if (defaultRole) await database.query(`INSERT INTO ${schema}.user_roles(user_id,role_id)
    SELECT u.id,r.id FROM ${schema}.users u CROSS JOIN ${schema}.roles r WHERE r.name=$1`, [defaultRole]);
}
