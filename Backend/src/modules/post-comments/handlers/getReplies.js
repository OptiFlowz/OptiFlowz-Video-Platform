import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { requireVisiblePost } from '../../posts/helpers/postAccess.js';
import { commentIdSchema, repliesQuerySchema } from '../helpers/postComments.shared.js';
import { listComments } from '../helpers/listComments.js';

export async function getRepliesInternal(params, query, userId = null, authorization = null) {
  const { id: parentId } = validateOrThrow(commentIdSchema.safeParse(params));
  const pagination = validateOrThrow(repliesQuerySchema.safeParse(query));
  const { rows } = await writePool.query(
    'SELECT post_id FROM public.post_comments WHERE id = $1 AND is_deleted = false',
    [parentId],
  );
  if (!rows.length) throw new HttpError(404, { message: 'Parent comment not found' });
  const postId = rows[0].post_id;
  await requireVisiblePost(writePool, postId, userId, authorization);
  const { comments, total } = await listComments(postId, parentId, userId, pagination);
  const { page, limit, sortBy, sortOrder } = pagination;
  const totalPages = Math.ceil(total / limit);
  return {
    replies: comments,
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    sorting: { sortBy, sortOrder },
    parent_id: parentId,
    post_id: postId,
  };
}
