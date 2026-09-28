import { z } from 'zod';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { deleteVideoResources } from '../../videos/helpers/deleteVideoResources.js';

const liveStreamIdSchema = z.string().uuid('Invalid live stream ID');

export async function deleteLiveStreamInternal(liveStreamId, userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
  const id = validateOrThrow(liveStreamIdSchema.safeParse(liveStreamId));
  return deleteVideoResources({ liveStreamId: id, ownerId: userId });
}
