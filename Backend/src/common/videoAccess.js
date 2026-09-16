import { HttpError } from './httpError.js';

// Owners can preview drafts and scheduled videos; everyone else must wait
// until publication. Call with the primary database for current access state.
export async function requireVisibleVideo(database, videoId, userId = null) {
  const { rows } = await database.query(
    `SELECT id FROM public.videos
     WHERE id = $1 AND mux_status = 'ready'
       AND ((visibility = 'public' AND published_at <= NOW())
         OR (visibility IN ('public', 'private') AND uploaded_by = $2))`,
    [videoId, userId],
  );
  if (!rows.length) throw new HttpError(404, { message: 'Video not found' });
}
