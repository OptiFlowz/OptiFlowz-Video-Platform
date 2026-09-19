import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { createPostSchema, requirePostUser, POST_COLUMNS } from '../helpers/posts.shared.js';

export async function createPostInternal(body, userId) {
  requirePostUser(userId);
  const data = validateOrThrow(createPostSchema.safeParse(body));
  const { rows } = await writePool.query(
    `INSERT INTO public.posts (user_id, title, status)
     VALUES ($1, $2, $3) RETURNING ${POST_COLUMNS}`,
    [userId, data.title, data.status],
  );
  return { ...rows[0], blocks: [] };
}
