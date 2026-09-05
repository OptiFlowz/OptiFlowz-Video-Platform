import { writePool } from '../../../database/index.js';

export async function deleteMyAccountInternal(userId) {
  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  try {
    // A single DELETE atomically applies the database's cascading cleanup.
    const { rowCount } = await writePool.query(
      'DELETE FROM public.users WHERE id = $1 RETURNING id',
      [userId],
    );

    if (rowCount === 0) {
      const error = new Error('User not found');
      error.status = 404;
      throw error;
    }

    return { deleted: true };
  } catch (error) {
    if (error.code === '23503') {
      const conflict = new Error('Account cannot be deleted while linked records prevent deletion');
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}
