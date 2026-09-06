import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

export async function createPlaylistInternal({ body: inputBody }, actorUserId = null) {
  try {
    const userId = actorUserId || null;
    if (!userId) throw new HttpError(401, { message: 'Unauthorized' });

    const title = String(inputBody?.title ?? '').trim();
    if (!title) {
      throw new HttpError(400, { message: 'title is required' });
    }

    const { rows } = await writePool.query(
      `
      INSERT INTO public.playlists (title, created_by, status)
      VALUES ($1, $2, 'private')
      RETURNING id, title, status, created_at
      `,
      [title, userId],
    );

    return { success: true, playlist: rows[0] };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('create playlist error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
