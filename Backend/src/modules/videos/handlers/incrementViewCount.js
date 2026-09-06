import { fileURLToPath } from 'url';
import path from 'path';
import maxmind from 'maxmind';
import { normalizeIp, hashIp } from '../helpers/video.shared.js';
import { writePool } from '../../../database/index.js';

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const GEOIP_DB_PATH = path.resolve(__dirname, '../../../../data/GeoLite2-City.mmdb');

const geoReaderPromise = maxmind.open(GEOIP_DB_PATH);

function isPrivateIp(ip) {
  if (!ip) return true;

  const lower = ip.toLowerCase();

  if (lower === '::1' || lower === 'localhost') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('192.168.')) return true;

  const match172 = ip.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  return false;
}

async function getCountryAndCityFromIp(ip) {
  const normalizedIp = normalizeIp(ip);

  if (!normalizedIp || isPrivateIp(normalizedIp)) {
    return { country: null, city: null };
  }

  try {
    const reader = await geoReaderPromise;
    const geo = reader.get(normalizedIp);

    return {
      // Ako hoćeš puno ime države umesto koda, stavi geo?.country?.names?.en
      country_iso: geo?.country?.iso_code || null,
      country: geo?.country?.names?.en || null,
      city: geo?.city?.names?.en || null,
    };
  } catch (error) {
    console.error('Local GeoIP lookup failed:', error);
    return { country: null, city: null };
  }
}

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
