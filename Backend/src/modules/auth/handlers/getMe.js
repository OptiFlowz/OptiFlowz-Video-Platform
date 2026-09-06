import { readPool } from '../../../database/index.js';
import { logEvent } from '../../../common/logger.js';
import { HttpError } from '../../../common/httpError.js';

export async function getMeInternal(actorUserId = null) {
  try {
    const { rows } = await readPool.query(
      `
        SELECT
          u.email,
          u.full_name,
          u.image_url,
          u.description,
          u.eaes_member,
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object('id', r.id, 'name', r.name)
                ORDER BY r.position ASC, r.id ASC
              )
              FROM public.user_roles ur
              JOIN public.roles r ON r.id = ur.role_id
              WHERE ur.user_id = u.id
                AND (ur.expires_at IS NULL OR ur.expires_at > now())
            ),
            '[]'::jsonb
          ) AS roles
        FROM public.users u
        WHERE u.id = $1
      `,
      [actorUserId],
    );
    if (!rows.length) {
      // Ako token postoji, ali user je obrisan/ne postoji -> front može da odradi logout
      logEvent('auth.me_failed', { user_id: actorUserId, message: 'No user' });
      throw new HttpError(401, {
        message: 'User does not exist',
      });
    }
    logEvent('auth.me_success', { user_id: actorUserId, message: 'Success' });
    return { user: rows[0] };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('User Error:', error);
    throw new HttpError(500, { message: 'Failed to fetch user' });
  }
}
