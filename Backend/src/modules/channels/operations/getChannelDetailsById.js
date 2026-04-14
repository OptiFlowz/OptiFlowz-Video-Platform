import { writePool } from '../../../database/index.js';
import { z } from 'zod';

function prerequisites(object) {
  const schema = z.object({id: z.string().uuid('Invalid channel ID'),});
  return schema.safeParse(object);
}

export async function getChannelDetailsByIdInternal(object) {
  const parsed = prerequisites(object);
  if (!parsed.success) {
    const error = new Error(parsed.error.issues[0]?.message || 'Invalid input');
    error.status = 400;
    throw error;
  }
  const { id } = parsed.data;

  const result = await writePool.query(
    `
    SELECT
      id,
      full_name,
      role,
      image_url,
      description
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

export default async function getChannelDetailsById(req, res) {
  try {
    const channel = await getChannelDetailsByIdInternal(req.params);

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: 'Channel not found',
      });
    }

    return res.status(200).json({
      success: true,
      channel,
    });
  } catch (error) {
    console.error('Error fetching channel by id:', error);

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
}