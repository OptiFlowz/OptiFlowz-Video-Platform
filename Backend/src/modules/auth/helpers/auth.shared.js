import { writePool } from '../../../database/index.js';

export async function assignDefaultRole(client, userId) {
  const { rows: defaultRoles } = await client.query(
    `
      SELECT id
      FROM roles
      WHERE is_default = true
      ORDER BY id
      LIMIT 2
    `,
  );

  if (defaultRoles.length !== 1) {
    throw new Error('Exactly one default role must be configured');
  }

  await client.query(
    `
      INSERT INTO user_roles (user_id, role_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, role_id) DO NOTHING
    `,
    [userId, defaultRoles[0].id],
  );
}

export async function getResetRecord(token, email) {
  const { rows } = await writePool.query(
    `
    SELECT pr.user_id, pr.expires_at, pr.used
    FROM password_resets pr
    JOIN users u
      ON pr.user_id = u.id
     AND u.email   = $2
    WHERE pr.token = $1
    `,
    [token, email],
  );
  return rows[0] ?? null;
}
