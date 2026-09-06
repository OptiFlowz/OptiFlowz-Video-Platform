import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

export async function deletePlaylistInternal(
  { params: routeParams, resourceAccess },
  actorUserId = null,
) {
  try {
    const userId = actorUserId || null;
    if (!userId) throw new HttpError(401, { message: 'Unauthorized' });

    const playlistId = routeParams.playlistId;

    if (!playlistId) {
      throw new HttpError(400, { message: 'playlistId is required' });
    }

    const result = await writePool.query(
      `
      DELETE 
      FROM public.playlists
      WHERE id = $1
        AND (created_by = $2 OR $3::boolean = true)
      `,
      [playlistId, userId, resourceAccess?.canAccessAny === true],
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, {
        success: false,
        message: 'Playlist not found or you do not have permission to delete it',
      });
    }

    return {
      success: true,
      message: 'Playlist deleted successfully',
      deletedId: playlistId,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('create playlist error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
