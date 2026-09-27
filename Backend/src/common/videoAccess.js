import { HttpError } from './httpError.js';
import { pageReadySql, playableSql, recordingReadySql } from './videoEligibility.js';

// Owners can preview drafts and scheduled videos; everyone else must wait
// until publication. Call with the primary database for current access state.
export async function requireVisibleVideo(database, videoId, userId = null, { recording = false, playable = false } = {}) {
  const { rows } = await database.query(
    `SELECT id FROM public.videos v
     WHERE id = $1 AND ${recording ? recordingReadySql() : playable ? playableSql() : pageReadySql()}
       AND ((visibility = 'public' AND published_at <= NOW())
         OR (visibility IN ('public', 'private') AND uploaded_by = $2))`,
    [videoId, userId],
  );
  if (!rows.length) throw new HttpError(404, { message: 'Video not found' });
}

export async function requireRecording(database, videoId) {
  const { rows } = await database.query(
    `SELECT id FROM public.videos v WHERE id = $1 AND ${recordingReadySql()}`, [videoId],
  );
  if (!rows.length) throw new HttpError(409, { message: 'A ready upload or finalized livestream recording is required' });
}
