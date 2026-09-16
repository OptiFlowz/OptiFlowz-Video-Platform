import { z } from 'zod';
import { HttpError } from '../../../common/httpError.js';

export const MAX_NOTES_PER_VIDEO = 100;
export const NOTE_COLUMNS = 'id, user_id, video_id, title, text, timestamp, color';

export const noteFields = {
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(10000),
  timestamp: z.number().finite().nonnegative(),
  color: z.string().trim().min(1).max(50).nullable().optional(),
};

export const noteIdSchema = z.object({ id: z.string().uuid('Invalid note id') });
export const videoIdSchema = z.object({ videoId: z.string().uuid('Invalid video id') });
export const createNoteSchema = z.object({
  video_id: z.string().uuid('Invalid video id'),
  ...noteFields,
}).strict();
export const editNoteSchema = z.object(noteFields).partial().strict().refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: 'Provide at least one note field to update' },
);

export function requireNoteUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}

export async function requireVisibleVideo(database, videoId, userId) {
  const { rows } = await database.query(
    `SELECT id FROM public.videos
     WHERE id = $1 AND mux_status = 'ready'
       AND (visibility = 'public' OR (visibility = 'private' AND uploaded_by = $2))`,
    [videoId, userId],
  );
  if (!rows.length) throw new HttpError(404, { message: 'Video not found' });
}
