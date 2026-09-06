import crypto from 'crypto';
import { writePool } from '../../../database/index.js';

function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT; // stavi neki random string u env
  return crypto.createHmac('sha256', salt).update(ip).digest('hex');
}

export async function incrementViewCountInternal(
  playlistId,
  { userId = null, ip = null, userAgent = '' } = {},
) {
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const hashedIp = hashIp(ip);

    let checkQuery, checkParams;

    if (userId) {
      checkQuery = `
        SELECT id
        FROM playlist_views
        WHERE playlist_id = $1
          AND user_id = $2
          AND created_at > NOW() - INTERVAL '2 hours'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      checkParams = [playlistId, userId];
    } else {
      checkQuery = `
        SELECT id
        FROM playlist_views
        WHERE playlist_id = $1
          AND user_id IS NULL
          AND ip_address = $2
          AND user_agent = $3
          AND created_at > NOW() - INTERVAL '2 hours'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      checkParams = [playlistId, hashedIp, userAgent];
    }

    const existing = await client.query(checkQuery, checkParams);

    // Ako postoji, vrati ID postojećeg view-a (ne povećava view_count)
    if (existing.rows.length > 0) {
      const view_id = existing.rows[0].id;
      await client.query('COMMIT');
      return { view_id, counted: false };
    }

    // Ako ne postoji, napravi novi i uzmi njegov ID
    let insertQuery, insertParams;

    if (userId) {
      insertQuery = `
        INSERT INTO playlist_views (playlist_id, user_id, ip_address, user_agent)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `;
      insertParams = [playlistId, userId, hashedIp, userAgent];
    } else {
      insertQuery = `
        INSERT INTO playlist_views (playlist_id, ip_address, user_agent)
        VALUES ($1, $2, $3)
        RETURNING id, 
      `;
      insertParams = [playlistId, hashedIp, userAgent];
    }

    const inserted = await client.query(insertQuery, insertParams);
    const view_id = inserted.rows[0].id;

    await client.query(`UPDATE playlists SET view_count = view_count + 1 WHERE id = $1`, [
      playlistId,
    ]);

    await client.query('COMMIT');
    return { view_id, counted: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('View count increment failed:', err);
    throw err; // da caller može da hendluje
  } finally {
    client.release();
  }
}
