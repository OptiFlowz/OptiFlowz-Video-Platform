import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import {
  buildPlaylistCardSelect,
  buildPlaylistCardJoins,
} from '../../../database/sql/playlistCardFragments.js';

function prerequisites(object) {
  const schema = z.object({
    id: z.string().uuid('Invalid playlist ID'),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function getPlaylistByIdInternal(object, userId = null) {
  const { id } = prerequisites(object);

  const query = `
    ${buildPlaylistCardSelect({ includeDescription: true })},
    p.tags,
    p.featured,
    p.save_count,
    CASE
      WHEN $2::uuid IS NULL THEN false
      ELSE EXISTS (
        SELECT 1
        FROM public.playlist_saves ps
        WHERE ps.playlist_id = p.id
          AND ps.user_id = $2::uuid
      )
    END AS is_saved
    ${buildPlaylistCardJoins()}
    WHERE
      p.id = $1
      AND (
        p.status = 'public'
        OR (
          p.status = 'private'
          AND p.created_by = $2
        )
      )
    LIMIT 1
  `;

  const result = await readPool.query(query, [id, userId]);

  return result.rows[0] || null;
}