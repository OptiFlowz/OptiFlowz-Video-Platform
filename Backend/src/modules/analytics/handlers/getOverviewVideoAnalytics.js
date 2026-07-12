import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object, userId) {
  const schema = z.object({
    videoId: z.string().uuid('Invalid attempt ID'),
    userId: z.string().uuid('Invalid user ID'),
    // check if this is right definition of zod scheme
    fromDate: z.date(),
    toDate: z.date()
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

export async function getOverviewVideoAnalyticsInternal(object, userId = null){
    const { videoId, userId: validatedUserId, fromDate, toDate } = prerequisites(object, userId);

    // Insert code here
}


