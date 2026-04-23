import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { hashIp } from '../../../common/ipUitl.js';

function prerequisites(object) {
  const schema = z.object({
    playlistId: z.string().uuid('Invalid playlist ID'),
    userId: z.string().uuid('Invalid user ID').nullable().optional().default(null),
    ip: z.string().trim().nullable().optional().default(null),
    userAgent: z.string().optional().default(''),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function playlistIncrementViewCountInternal(object) {
  const { playlistId, userId, ip, userAgent } = prerequisites(object);
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const hashedIp = ip ? hashIp(ip) : null;

    const existingViewQuery = userId
      ? `
          SELECT id
          FROM playlist_views
          WHERE playlist_id = $1
            AND user_id = $2
            AND created_at > NOW() - INTERVAL '2 hours'
          ORDER BY created_at DESC
          LIMIT 1
        `
      : `
          SELECT id
          FROM playlist_views
          WHERE playlist_id = $1
            AND user_id IS NULL
            AND ip_address = $2
            AND user_agent = $3
            AND created_at > NOW() - INTERVAL '2 hours'
          ORDER BY created_at DESC
          LIMIT 1
        `;

    const existingViewParams = userId
      ? [playlistId, userId]
      : [playlistId, hashedIp, userAgent];

    const existingViewResult = await client.query(existingViewQuery, existingViewParams);

    if (existingViewResult.rows.length > 0) {
      await client.query('COMMIT');

      return {
        view_id: existingViewResult.rows[0].id,
        counted: false,
      };
    }

    const insertViewQuery = userId
      ? `
          INSERT INTO playlist_views (
            playlist_id,
            user_id,
            ip_address,
            user_agent
          )
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `
      : `
          INSERT INTO playlist_views (
            playlist_id,
            ip_address,
            user_agent
          )
          VALUES ($1, $2, $3)
          RETURNING id
        `;

    const insertViewParams = userId
      ? [playlistId, userId, hashedIp, userAgent]
      : [playlistId, hashedIp, userAgent];

    const insertedViewResult = await client.query(insertViewQuery, insertViewParams);
    const viewId = insertedViewResult.rows[0].id;

    await client.query(
      `
        UPDATE playlists
        SET view_count = view_count + 1
        WHERE id = $1
      `,
      [playlistId]
    );

    await client.query('COMMIT');

    return {
      view_id: viewId,
      counted: true,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Playlist view count increment failed:', error);
    throw error;
  } finally {
    client.release();
  }
}