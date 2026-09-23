import { withPlaylistCardMedia } from '../../playlists/helpers/playlistCardMedia.js';
import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quiz ID'),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function getQuizQuestionSourcesInternal(object, userId) {
  const { quizId } = prerequisites(object);

  const { rows } = await readPool.query(
    `
      SELECT
        qqs.id,
        qqs.quiz_id,
        qqs.source_type,

        qqs.playlist_id,
        p.title AS playlist_title,
        p.thumbnail_url AS playlist_thumbnail,

        qqs.video_id,
        v.title AS video_title,
        v.thumbnail_url AS video_thumbnail,

        qqs.percentage,
        qqs.fixed_question_count,
        qqs.include_general_questions
      FROM quiz_question_sources qqs
      LEFT JOIN playlists p
        ON p.id = qqs.playlist_id
      LEFT JOIN videos v
        ON v.id = qqs.video_id
      WHERE qqs.quiz_id = $1
      ORDER BY
        CASE qqs.source_type
          WHEN 'playlist' THEN 1
          WHEN 'video' THEN 2
          WHEN 'general' THEN 3
          WHEN 'manual' THEN 4
          ELSE 5
        END,
        qqs.id;
    `,
    [quizId]
  );

  const playlists = await withPlaylistCardMedia(
    rows.filter(row => row.playlist_id).map(row => ({ id: row.playlist_id })), userId,
  );
  const thumbnails = new Map(playlists.map(playlist => [playlist.id, playlist]));
  return rows.map(row => ({
    ...row,
    playlist_thumbnail: thumbnails.get(row.playlist_id)?.thumbnail_url ?? null,
    playlist_media_expires_at: thumbnails.get(row.playlist_id)?.media_expires_at ?? null,
  }));
}