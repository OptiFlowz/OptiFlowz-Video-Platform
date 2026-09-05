import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    id: z.string().uuid('Invalid channel ID'),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function getChannelDetailsByIdInternal(object) {
  const { id } = prerequisites(object);

  const result = await writePool.query(
    `
    SELECT
      id,
      full_name,
      image_url,
      description
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );
  
  return result.rows[0] || null;
}
