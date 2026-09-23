import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { hasPermission, loadAuthorization } from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';
import { commentIdSchema } from '../helpers/postComments.shared.js';
import { withPostCommentMutation } from '../helpers/postCommentAccess.js';

export async function deleteCommentInternal(params, userId, authorization) {
  const { id } = validateOrThrow(commentIdSchema.safeParse(params));
  return withPostCommentMutation(id, userId, authorization, async (client, comment) => {
    const access = authorization || await loadAuthorization(userId, client);
    if (comment.user_id.toLowerCase() !== userId.toLowerCase()
      && !hasPermission(access, Permissions.COMMENTS_MODERATE)) {
      throw new HttpError(403, { message: 'You can only delete your own comment' });
    }
    await client.query(
      'UPDATE public.post_comments SET is_deleted = true, updated_at = NOW() WHERE id = $1',
      [comment.id],
    );
    return { deleted: true };
  });
}
