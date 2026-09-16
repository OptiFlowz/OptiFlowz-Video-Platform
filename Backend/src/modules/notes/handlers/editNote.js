import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { editNoteSchema, noteIdSchema, NOTE_COLUMNS, requireNoteUser } from '../helpers/notes.shared.js';

export async function editNoteInternal(params, body, userId) {
  requireNoteUser(userId);
  const { id } = validateOrThrow(noteIdSchema.safeParse(params));
  const updates = validateOrThrow(editNoteSchema.safeParse(body));
  // Only schema-validated field names can become SQL identifiers.
  const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
  const assignments = entries.map(([field], index) => `${field} = $${index + 3}`);
  const { rows } = await writePool.query(
    `UPDATE public.notes SET ${assignments.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING ${NOTE_COLUMNS}`,
    [id, userId, ...entries.map(([, value]) => value)],
  );
  // Do not expose whether another user's private note exists.
  if (!rows.length) throw new HttpError(404, { message: 'Note not found' });
  return rows[0];
}
