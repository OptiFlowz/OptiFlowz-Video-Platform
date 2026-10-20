import type { Requirement } from './model';

type Write = (path: string, method: string, body?: unknown) => Promise<unknown>;
type Threshold = Pick<Requirement, 'min_watch_percentage' | 'min_watch_seconds'>;

/** The API identifies a requirement by its video; it cannot PATCH video_id. */
export async function saveRequirement(write: Write, original: Requirement, isNew: boolean, videoId: string, threshold: Threshold, rollbackError: string) {
  const path = `/quiz-requirements/${original.quiz_id}`;
  if (!isNew && videoId === original.video_id) {
    await write(`${path}/${videoId}`, 'PATCH', threshold);
    return;
  }
  // Keep the old rule until the replacement has been accepted by the server.
  await write('/quiz-requirements', 'POST', {
    quiz_id: original.quiz_id, video_id: videoId, position: original.position, ...threshold,
  });
  if (isNew) return;
  try {
    await write(`${path}/${original.video_id}`, 'DELETE');
  } catch (error) {
    try {
      // A lost DELETE response does not prove deletion failed. Only roll back
      // when the old rule is confirmed present, so we cannot remove both.
      const current = await write(`${path}/${original.video_id}`, 'GET') as { requirement?: Requirement };
      if (current?.requirement?.video_id !== original.video_id) throw error;
      await write(`${path}/${videoId}`, 'DELETE');
    }
    catch { throw new Error(rollbackError, { cause: error }); }
    throw error;
  }
}
