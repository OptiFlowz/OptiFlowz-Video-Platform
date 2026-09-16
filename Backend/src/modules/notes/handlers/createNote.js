import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import {
  createNoteSchema, MAX_NOTES_PER_VIDEO, NOTE_COLUMNS, requireNoteUser, requireVisibleVideo,
} from '../helpers/notes.shared.js';

export async function createNoteInternal(body, userId) {
  requireNoteUser(userId);
  const { video_id, title, text, timestamp, color = null } = validateOrThrow(createNoteSchema.safeParse(body));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // Serialize this user's creates; count in a separate statement after the lock
    // so a waiting request sees notes committed by the previous request.
    const user = await client.query('SELECT id FROM public.users WHERE id = $1 FOR UPDATE', [userId]);
    if (!user.rows.length) throw new HttpError(401, { message: 'Unauthorized' });

    await requireVisibleVideo(client, video_id, userId);
    const { rows: counts } = await client.query(
      'SELECT COUNT(*)::int AS total FROM public.notes WHERE user_id = $1 AND video_id = $2',
      [userId, video_id],
    );
    if (counts[0].total >= MAX_NOTES_PER_VIDEO) {
      throw new HttpError(409, { message: `You can create up to ${MAX_NOTES_PER_VIDEO} notes per video` });
    }

    const { rows } = await client.query(
      `INSERT INTO public.notes (user_id, video_id, title, text, timestamp, color)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${NOTE_COLUMNS}`,
      [userId, video_id, title, text, timestamp, color],
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
