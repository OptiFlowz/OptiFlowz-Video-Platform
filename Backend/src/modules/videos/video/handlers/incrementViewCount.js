import { normalizeIp, hashIp, getCountryAndCityFromIp } from '../../../../common/ip.js';
import { writePool } from '../../../../database/index.js';

export async function incrementViewCountInternal(
  videoId,
  { userId = null, ip = null, userAgent = '' } = {},
) {
  const rawIp = normalizeIp(ip);

  // Lookup radi nad sirovim IP-jem, pre hashovanja
  const { country, city, country_iso } = await getCountryAndCityFromIp(rawIp);

  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const hashedIp = hashIp(rawIp);

    let checkQuery, checkParams;

    if (userId) {
      checkQuery = `
        SELECT id, COALESCE(last_seq,0) AS last_seq
        FROM video_views
        WHERE video_id = $1
          AND user_id = $2
          AND created_at > NOW() - INTERVAL '2 hours'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      checkParams = [videoId, userId];
    } else {
      checkQuery = `
        SELECT id, COALESCE(last_seq,0) AS last_seq
        FROM video_views
        WHERE video_id = $1
          AND user_id IS NULL
          AND ip_address = $2
          AND user_agent = $3
          AND created_at > NOW() - INTERVAL '2 hours'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      checkParams = [videoId, hashedIp, userAgent];
    }

    const existing = await client.query(checkQuery, checkParams);

    // Ako postoji, vrati ID postojećeg view-a (ne povećava view_count)
    if (existing.rows.length > 0) {
      const view_id = existing.rows[0].id;
      const last_seq = existing.rows[0].last_seq;
      await client.query('COMMIT');
      return { view_id, last_seq, counted: false };
    }

    // Ako ne postoji, napravi novi i uzmi njegov ID

    // Ovde dodati pracenje drzava i gradova
    let insertQuery, insertParams;

    if (userId) {
      insertQuery = `
        INSERT INTO video_views (
          video_id,
          user_id,
          ip_address,
          user_agent,
          country,        
          city,
          country_iso
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, COALESCE(last_seq,0) AS last_seq
      `;
      insertParams = [videoId, userId, hashedIp, userAgent, country, city, country_iso];
    } else {
      insertQuery = `
        INSERT INTO video_views (
          video_id,
          ip_address,
          user_agent,
          country,
          city,
          country_iso
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, COALESCE(last_seq,0) AS last_seq
      `;
      insertParams = [videoId, hashedIp, userAgent, country, city, country_iso];
    }

    const inserted = await client.query(insertQuery, insertParams);
    const view_id = inserted.rows[0].id;
    const last_seq = inserted.rows[0].last_seq;
    await client.query(`UPDATE videos SET view_count = view_count + 1 WHERE id = $1`, [videoId]);

    await client.query('COMMIT');
    return { view_id, last_seq, counted: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('View count increment failed:', err);
    throw err; // da caller može da hendluje
  } finally {
    client.release();
  }
}
