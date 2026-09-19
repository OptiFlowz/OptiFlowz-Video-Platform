import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { postIdSchema } from '../helpers/posts.shared.js';
import { postBlocksSql } from '../helpers/postBlocksSql.js';
import { hasPermission, loadAuthorization } from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';

export async function getPostInternal(params, userId = null, authorization = null) {
  const { postId } = validateOrThrow(postIdSchema.safeParse(params));
  const access = userId ? authorization || await loadAuthorization(userId) : null;
  const canUpdateAny = access ? hasPermission(access, Permissions.POSTS_UPDATE_ANY) : false;

  // Read current visibility and the entire post in one primary-database snapshot.
  // Explicit option fields keep respondent identities out of the response.
  const { rows } = await writePool.query(
    `SELECT p.id, p.user_id, p.title, p.status, p.created_at,
       u.full_name AS author_full_name, u.image_url AS author_image_url,
       ${postBlocksSql('$2::uuid')} AS blocks
     FROM public.posts p
     LEFT JOIN public.users u ON u.id = p.user_id
     WHERE p.id = $1
       AND (p.status = 'public' OR p.user_id = $2::uuid OR $3::boolean)`,
    [postId, userId, canUpdateAny],
  );
  if (!rows.length) throw new HttpError(404, { message: 'Post not found' });
  return rows[0];
}
