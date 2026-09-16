import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { noteIdSchema, requireNoteUser } from '../helpers/notes.shared.js';

export async function deleteNoteInternal(params, userId) {
  requireNoteUser(userId);
  const { id } = validateOrThrow(noteIdSchema.safeParse(params));
  const { rows } = await writePool.query(
    'DELETE FROM public.notes WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId],
  );
  if (!rows.length) throw new HttpError(404, { message: 'Note not found' });
  return { deleted: true };
}
