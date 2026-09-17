import { transaction, scheduleOverview } from '../../video-indexing/indexing.service.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(params, body, userId) {
  const schema = z.object({
    personId: z.string().uuid('Invalid person ID'),
    name: z.string().trim().min(1, 'Name is required').max(255).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  }).refine(
    (data) => data.name !== undefined || data.description !== undefined,
    {
      message: 'At least one field must be provided',
      path: ['name'],
    }
  );

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

  return transaction(async client => {
    if (name !== undefined) {
      await client.query('SELECT id FROM people WHERE id=$1 FOR UPDATE', [personId]);
    }
    const result = await client.query(
      `UPDATE public.people
       SET name = COALESCE($2, name),
           description = CASE WHEN $3::boolean THEN $4 ELSE description END
       WHERE id = $1
       RETURNING id, name, description, image_url`,
      [personId, name ?? null, Object.hasOwn(body, 'description'), description ?? null],
    );

    if (!result.rowCount) {
      const error = new Error('Person not found');
      error.status = 404;
      throw error;
    }

    if (name !== undefined) {
      const { rows: videos } = await client.query(
        'SELECT DISTINCT video_id FROM video_chairs WHERE person_id=$1 ORDER BY video_id',
        [personId],
      );
      for (const video of videos) await scheduleOverview(client, video.video_id);
    }
    return result.rows[0];
  });
}
