import { withPlaylistCardMedia } from '../../playlists/helpers/playlistCardMedia.js';
import { readPool } from '../../../database/index.js';

export async function getQuizAccessRulesInternal(quizId, userId) {
  const { rows } = await readPool.query(
    `
      SELECT 
        qar.id AS rule_id,
        qar.rule_type,
        qar.video_id,
        qar.playlist_id,
        qar.required_percentage,
        qar.required_seconds,
        qar.required_quiz_id,
        qar.is_active,
        v.title AS video_title,
        v.thumbnail_url AS video_thumbnail,
        p.title AS playlist_title,
        p.thumbnail_url AS playlist_thumbnail
      FROM quiz_access_rules qar
      LEFT JOIN videos v ON qar.video_id = v.id
      LEFT JOIN playlists p ON qar.playlist_id = p.id
      WHERE qar.quiz_id = $1
      ORDER BY qar.id;
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