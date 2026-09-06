import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

const updateUserSchema = z
  .object({
    full_name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    eaes_member: z.boolean().optional(),
  })
  .strict();

export async function userUpdateInternal({ body: inputBody }, actorUserId = null) {
  try {
    const userId = actorUserId || null;
    if (!userId) {
      throw new HttpError(401, { message: 'Unauthorized' });
    }

    const parsed = updateUserSchema.safeParse(inputBody);
    if (!parsed.success) {
      throw new HttpError(400, {
        message: 'Invalid input',
        errors: parsed.error.flatten(),
      });
    }

    const { full_name, description, eaes_member } = parsed.data;

    // Ako nije poslato ništa za update
    if (
      typeof full_name === 'undefined' &&
      typeof description === 'undefined' &&
      typeof eaes_member === 'undefined'
    ) {
      throw new HttpError(400, { message: 'No fields provided for update' });
    }

    const sql = `
      UPDATE public.users
      SET
        full_name    = COALESCE($1, full_name),
        description  = COALESCE($2, description),
        eaes_member  = COALESCE($3, eaes_member),
        updated_at   = NOW()
      WHERE id = $4
      RETURNING email, full_name, image_url, description, eaes_member;
    `;

    // Bitno: prosleđujemo null za "nije poslato", da COALESCE radi
    const values = [
      typeof full_name === 'undefined' ? null : full_name,
      typeof description === 'undefined' ? null : description,
      typeof eaes_member === 'undefined' ? null : eaes_member,
      userId,
    ];

    const { rows } = await writePool.query(sql, values);

    if (rows.length === 0) {
      throw new HttpError(404, { message: 'User not found' });
    }

    return { user: rows[0] };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('PATCH /user error:', err);
    throw new HttpError(500, { message: 'Internal server error' });
  }
}
