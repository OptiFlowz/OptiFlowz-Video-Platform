import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import * as muxService from '../mux.service.js';

const createVideoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  // categories are UUID strings (category IDs) coming from the client
  categories: z.array(z.string().uuid()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
});

export async function initiateVideoUploadInternal(videoData, userId) {
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    // 1) Validate input
    const validated = createVideoSchema.parse(videoData);

    // 2) Create Mux upload URL
    const { uploadUrl, uploadId } = await muxService.createUploadUrl();

    // 3) Insert the video (NOTE: no single 'category' column anymore)
    const insertVideoSql = `
      INSERT INTO videos (
        title,
        description,
        tags,
        uploaded_by,
        mux_upload_id,
        mux_status
      )
      VALUES ($1, $2, $3, $4, $5, 'uploading')
      RETURNING id, title, mux_upload_id
    `;

    const { rows } = await client.query(insertVideoSql, [
      validated.title,
      validated.description ?? null,
      validated.tags ?? [],
      userId,
      uploadId,
    ]);

    const videoId = rows[0].id;

    // 4) Link categories via junction table
    if (validated.categories && validated.categories.length > 0) {
      // Option A: fast bulk insert using UNNEST
      await client.query(
        `
        INSERT INTO video_categories (video_id, category_id)
        SELECT $1, c
        FROM unnest($2::uuid[]) AS c
        ON CONFLICT DO NOTHING
        `,
        [videoId, validated.categories],
      );
      // (Primary key on (video_id, category_id) prevents duplicates)
    }

    await client.query('COMMIT');

    return {
      videoId,
      uploadUrl,
      uploadId,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Video upload initiation failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
