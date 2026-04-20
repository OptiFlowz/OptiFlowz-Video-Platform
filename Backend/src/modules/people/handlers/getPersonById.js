import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    personId: z.string().uuid('Invalid person ID'),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function getPersonByIdInternal(object) {
  const { personId } = prerequisites(object);

  const result = await readPool.query(
    `
      SELECT id,name,description,image_url
      FROM public.people
      WHERE id = $1
      LIMIT 1
    `,
    [personId]
  );

  return result.rows[0] || null;
}