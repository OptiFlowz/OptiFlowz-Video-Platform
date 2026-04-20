import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(body, userId) {
  const schema = z.object({
    name: z.string().trim().min(1, 'Name is required').max(255),
    description: z.string().trim().max(2000).optional().nullable(),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse(body));
}

export async function createPersonInternal(body, userId) {
  const { name, description } = prerequisites(body, userId);

  const result = await writePool.query(
    `
      INSERT INTO public.people (name, description)
      VALUES ($1, $2)
      RETURNING id, name, description, image_url
    `,
    [name, description || null]
  );

  return result.rows[0];
}