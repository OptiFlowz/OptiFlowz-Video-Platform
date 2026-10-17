import { z } from 'zod';
import { HttpError } from '../../../../common/httpError.js';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const fields = {
  min_watch_percentage: z.number().finite().gt(0).max(100).multipleOf(0.01).nullable(),
  min_watch_seconds: z.number().int().min(1).max(2147483647).nullable(),
  position: z.number().int().min(0).max(2147483647),
};
function exactlyOneThreshold(value) {
  return (value.min_watch_percentage !== null) !== (value.min_watch_seconds !== null);
}
const thresholdMessage = 'Exactly one of min_watch_percentage and min_watch_seconds must be set';

export const quizRequirementIdSchema = z.object({ quizId: uuid, videoId: uuid });
export const checkQuizRequirementsSchema = z.object({ quizId: uuid, userId: uuid });
export const quizRequirementFieldsSchema = z.object(fields).strict()
  .refine(exactlyOneThreshold, { message: thresholdMessage });
export const createQuizRequirementSchema = z.object({
  quiz_id: uuid,
  video_id: uuid,
  min_watch_percentage: fields.min_watch_percentage.optional().default(null),
  min_watch_seconds: fields.min_watch_seconds.optional().default(null),
  position: fields.position.optional().default(0),
}).strict().refine(exactlyOneThreshold, { message: thresholdMessage });
export const updateQuizRequirementSchema = z.object(fields).partial().strict().refine(
  updates => Object.values(updates).some(value => value !== undefined),
  { message: 'Provide at least one quiz requirement field to update' },
);
export const listQuizRequirementsSchema = z.object({
  quiz_id: uuid.optional(),
  sortBy: z.enum(['position', 'quiz_id', 'video_id', 'min_watch_percentage', 'min_watch_seconds'])
    .optional().default('position'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
});

export function requireQuizRequirementUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}

export function validateVideoDuration(requirement, video) {
  if (requirement.min_watch_seconds !== null
    && (video.duration_seconds === null || requirement.min_watch_seconds > video.duration_seconds)) {
    throw new HttpError(400, { message: 'min_watch_seconds requires a known video duration and cannot exceed it' });
  }
}
