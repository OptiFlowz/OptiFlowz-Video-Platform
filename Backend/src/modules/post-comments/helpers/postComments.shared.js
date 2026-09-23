import { z } from 'zod';

export const COMMENT_COLUMNS = 'id, post_id, user_id, parent_id, content, like_count, dislike_count, reply_count, created_at, updated_at';
export const commentIdSchema = z.object({ id: z.string().uuid('Invalid comment id') });
export const createCommentSchema = z.object({
  post_id: z.string().uuid('Invalid post id'),
  parent_id: z.string().uuid('Invalid parent id').nullable().optional(),
  content: z.string().trim().min(1).max(500),
}).strict();
export const editCommentSchema = z.object({ content: z.string().trim().min(1).max(2000) });
export const reactionSchema = z.enum(['like', 'dislike']);

const pagination = {
  page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
};
const validOffset = data => Number.isSafeInteger((data.page - 1) * data.limit);
export const commentsQuerySchema = z.object({
  ...pagination,
  sort: z.string().transform(value => value.toLowerCase() === 'top' ? 'top' : 'new').optional().default('new'),
}).refine(validOffset, { message: 'Requested page is too large' });
export const repliesQuerySchema = z.object({
  ...pagination,
  sortBy: z.enum(['created_at', 'like_count']).optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
}).refine(validOffset, { message: 'Requested page is too large' });

export const COMMENT_SELECT = `c.id, c.post_id, c.user_id, c.parent_id, c.content,
  c.like_count, c.dislike_count, c.reply_count, c.created_at, c.updated_at,
  u.full_name AS author_full_name, u.image_url AS author_image_url,
  cr.reaction AS my_reaction`;
