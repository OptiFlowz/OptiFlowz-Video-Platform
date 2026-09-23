import { HttpError } from '../../../common/httpError.js';
import { hasPermission, loadAuthorization } from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';
import { requirePostUser } from './posts.shared.js';

export async function requireVisiblePost(database, postId, userId = null, authorization = null, lock = false) {
  const { rows } = await database.query(
    `SELECT id, user_id, status FROM public.posts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [postId],
  );
  const post = rows[0];
  if (!post) throw new HttpError(404, { message: 'Post not found' });
  if (post.status !== 'public' && post.user_id.toLowerCase() !== userId?.toLowerCase()) {
    const access = userId ? authorization || await loadAuthorization(userId, database) : null;
    if (!access || !hasPermission(access, Permissions.POSTS_UPDATE_ANY)) {
      throw new HttpError(404, { message: 'Post not found' });
    }
  }
  return post;
}

async function requirePostAccess(database, postId, userId, authorization, lock, ownPermission, anyPermission, action) {
  requirePostUser(userId);
  const { rows } = await database.query(
    `SELECT id, user_id FROM public.posts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [postId],
  );
  const post = rows[0];
  if (!post) throw new HttpError(404, { message: 'Post not found' });
  const access = authorization || await loadAuthorization(userId, database);
  const allowed = hasPermission(access, anyPermission)
    || (post.user_id === userId && hasPermission(access, ownPermission));
  if (!allowed) throw new HttpError(403, { message: `You cannot ${action} this post` });
  return access;
}

export function requireEditablePost(database, postId, userId, authorization, lock = false) {
  return requirePostAccess(database, postId, userId, authorization, lock,
    Permissions.POSTS_UPDATE_OWN, Permissions.POSTS_UPDATE_ANY, 'update');
}

export function requireDeletablePost(database, postId, userId, authorization, lock = false) {
  return requirePostAccess(database, postId, userId, authorization, lock,
    Permissions.POSTS_DELETE_OWN, Permissions.POSTS_DELETE_ANY, 'delete');
}
