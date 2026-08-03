import { writePool } from '../../../database/index.js';

export async function getPermissionsInternal() {
  const { rows } = await writePool.query(
    `
      SELECT
        id,
        key,
        description,
        group_name,
        resource_type,
        risk_level
      FROM permissions
      ORDER BY group_name ASC, key ASC
    `,
  );

  const groups = rows.reduce((result, permission) => {
    const group = result.find((item) => item.name === permission.group_name);
    if (group) {
      group.permissions.push(permission);
    } else {
      result.push({
        name: permission.group_name,
        permissions: [permission],
      });
    }
    return result;
  }, []);

  return {
    groups,
  };
}
