import { deleteVideoResources } from '../../helpers/deleteVideoResources.js';
import { HttpError } from '../../../../common/httpError.js';

export async function deleteVideoInternal({ params: routeParams }) {
  try {
    return await deleteVideoResources({ videoId: routeParams.videoId });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('delete video route error');
    throw new HttpError(500, { message: 'Server error' });
  }
}
