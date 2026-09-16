import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { NOTE_COLUMNS, requireNoteUser, requireVisibleVideo, videoIdSchema } from '../helpers/notes.shared.js';

export async function getVideoNotesInternal(params, userId) {
  requireNoteUser(userId);
  const { videoId } = validateOrThrow(videoIdSchema.safeParse(params));
  // Read from the primary so newly saved notes are immediately visible.
  await requireVisibleVideo(writePool, videoId, userId);
  const { rows } = await writePool.query(
    `SELECT ${NOTE_COLUMNS} FROM public.notes
     WHERE user_id = $1 AND video_id = $2
     ORDER BY timestamp ASC, id ASC`,
    [userId, videoId],
  );
  return { notes: rows };
}
