import { z } from 'zod';
import { HttpError } from '../../../common/httpError.js';

export const MAX_POST_BLOCKS = 50;
export const MAX_BLOCK_OPTIONS = 20;
export const POST_COLUMNS = 'id, user_id, title, status, created_at';
export const BLOCK_COLUMNS = 'id, post_id, type, position, content';
export const OPTION_COLUMNS = 'id, block_id, text, image_url, position';

const blockText = z.string().trim().max(10000);
const textContent = z.object({ text: blockText.min(1) }).strict();
const imageContent = z.object({ text: blockText.optional() }).strict();
const videoContent = z.object({
  video_id: z.string().uuid('Invalid video id'),
  text: blockText.optional(),
}).strict();
const optionFields = {
  text: z.string().trim().min(1).max(500),
  position: z.number().int().min(0).max(MAX_BLOCK_OPTIONS - 1).optional(),
};
const pollOption = z.object(optionFields).strict();
const questionerOption = z.object({
  ...optionFields,
  is_correct: z.boolean().optional().default(false),
}).strict();

function blockOptions(schema) {
  return z.array(schema).min(2).max(MAX_BLOCK_OPTIONS).refine(options => {
    const positions = options.map((option, index) => option.position ?? index);
    return new Set(positions).size === options.length && positions.every(position => position < options.length);
  }, { message: 'Option positions must be unique and cover zero through the last option index' });
}

export const postBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), content: textContent }).strict(),
  z.object({
    type: z.literal('image'),
    content: imageContent.optional().default({}),
  }).strict(),
  z.object({
    type: z.literal('video'),
    content: videoContent,
  }).strict(),
  z.object({
    type: z.literal('poll'),
    content: textContent,
    options: blockOptions(pollOption),
  }).strict(),
  z.object({
    type: z.literal('questioner'),
    content: textContent,
    options: blockOptions(questionerOption).refine(
      options => options.some(option => option.is_correct),
      { message: 'A questioner must have at least one correct option' },
    ),
  }).strict(),
]);

export const createPostSchema = z.object({
  title: z.string().trim().min(1).max(255),
  status: z.enum(['private', 'public']).optional().default('private'),
}).strict();

export const editPostSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  status: z.enum(['private', 'public']).optional(),
  block_order: z.array(z.string().uuid()).max(MAX_POST_BLOCKS).refine(ids => new Set(ids).size === ids.length, { message: 'Duplicate block IDs' }).optional(),
}).strict().refine(data => Object.keys(data).length > 0, { message: 'Provide a field to update' });

export const myPostsQuerySchema = z.object({
  q: z.string().trim().max(255).optional().default(''),
  page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(['title', 'status', 'created_at', 'content']).optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Requested page is too large',
});

// Add supported sort keys and their trusted SQL expressions here. Validation
// derives from these keys so the public feed's sort contract stays in sync.
export const PUBLIC_POST_SORT_FIELDS = Object.freeze({
  created_at: 'created_at',
});

export const publicPostsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(Object.keys(PUBLIC_POST_SORT_FIELDS)).optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Requested page is too large',
});

export const postIdSchema = z.object({ postId: z.string().uuid('Invalid post id') });
export const postUserIdSchema = z.object({ userId: z.string().uuid('Invalid user id') });
export const postUserIdsSchema = z.array(postUserIdSchema.shape.userId).max(100)
  .transform(ids => [...new Set(ids.map(id => id.toLowerCase()))]);
export const recommendedPostsSchema = z.object({ user_ids: postUserIdsSchema }).strict();
export const postBlockIdSchema = postIdSchema.extend({
  blockId: z.string().uuid('Invalid post block id'),
});
export const postOptionIdSchema = postBlockIdSchema.extend({
  optionId: z.string().uuid('Invalid post option id'),
});
export const postResponseSchema = z.object({
  option_id: z.string().uuid('Invalid post option id'),
}).strict();

export const questionerAnswerSchema = z.union([
  postResponseSchema,
  z.object({ option_ids: z.array(z.string().uuid('Invalid post option id'))
    .min(1).max(20).refine(ids => new Set(ids.map(id => id.toLowerCase())).size === ids.length, { message: 'Duplicate option IDs' }) }).strict(),
]);

export const pollVoteSchema = postResponseSchema.extend({
  remove: z.boolean().optional().default(false),
});

export const editBlockSchemas = {
  text: z.object({ content: textContent }).strict(),
  image: z.object({ content: imageContent.optional() }).strict(),
  video: z.object({ content: videoContent.partial() }).strict(),
  poll: z.object({ content: textContent }).strict(),
  questioner: z.object({ content: textContent }).strict(),
};
export const createOptionSchemas = { poll: pollOption, questioner: questionerOption };
export const editOptionSchemas = {
  poll: z.object({ text: optionFields.text.optional(), position: optionFields.position }).strict(),
  questioner: z.object({
    text: optionFields.text.optional(),
    position: optionFields.position,
    is_correct: z.boolean().optional(),
  }).strict(),
};

export function requirePostUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}
