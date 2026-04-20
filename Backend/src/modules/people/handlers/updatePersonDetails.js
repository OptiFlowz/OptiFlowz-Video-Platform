import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(params, body, userId) {
  const schema = z.object({
    personId: z.string().uuid('Invalid person ID'),
    name: z.string().trim().min(1, 'Name is required').max(255),
    description: z.string().trim().max(2000).nullable().optional(),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(
    schema.safeParse({
      ...params,
      ...body,
    })
  );
}

export async function updatePersonDetailsInternal(params, body, userId) {
  const { personId, name, description } = prerequisites(params, body, userId);

  const result = await writePool.query(
    `
      UPDATE public.people
      SET
        name = $2,
        description = $3
      WHERE id = $1
      RETURNING id, name, description, image_url
    `,
    [personId, name, description ?? null]
  );

  if (!result.rowCount) {
    const error = new Error('Person not found');
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}