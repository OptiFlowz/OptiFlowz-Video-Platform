import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { postIdSchema } from '../../posts/helpers/posts.shared.js';
import { requireVisiblePost } from '../../posts/helpers/postAccess.js';
import { commentsQuerySchema } from '../helpers/postComments.shared.js';
import { listComments } from '../helpers/listComments.js';

export async function getCommentsInternal(params, query, userId = null, authorization = null) {
  const { postId } = validateOrThrow(postIdSchema.safeParse(params));
  const { page, limit, sort } = validateOrThrow(commentsQuerySchema.safeParse(query));
  await requireVisiblePost(writePool, postId, userId, authorization);
  const { comments, total } = await listComments(postId, null, userId, {
    page, limit, sortBy: sort === 'top' ? 'like_count' : 'created_at', sortOrder: 'desc',
  });
  return { comments, page, limit, total, total_pages: Math.ceil(total / limit) };
}
