import { readPool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

export async function getCategoriesInternal({ query: queryParams }) {
  try {
    const { limit = 20, page = 1 } = queryParams;

    const query = `
            SELECT * FROM categories
            ORDER BY number ASC 
            LIMIT $1 OFFSET $2
        `;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows } = await readPool.query(query, [Math.min(parseInt(limit), 100), offset]);

    return {
      categories: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
      },
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Categories error:', error);
    throw new HttpError(500, { message: 'Failed to fetch categories' });
  }
}
