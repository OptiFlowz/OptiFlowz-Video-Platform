// videoService.js
import {  readPool,writePool } from '../../database/index.js';
import * as muxService from './mux.service.js';
import { z } from 'zod';
import crypto from "crypto";
import { Console } from 'console';
import maxmind from 'maxmind';
import path from 'path';
import { fileURLToPath } from 'url';


function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT; // stavi neki random string u env
  return crypto.createHmac("sha256", salt).update(ip).digest("hex");
}

// Validation schemas
const createVideoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  // categories are UUID strings (category IDs) coming from the client
  categories: z.array(z.string().uuid()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
});

const updateVideoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  categories: z.array(z.string().uuid()).optional(), // replace all categories if provided
  tags: z.array(z.string()).optional(),
  published_at: z.string().datetime().optional(),
});

/**
 * Inicijalizuje upload procesa za novi video
 * @param {Object} videoData - Osnovni podaci o videu
 * @param {string} userId - ID korisnika koji upload-uje
 * @returns {Object} Upload URL i video ID
 */
export async function initiateVideoUpload(videoData, userId) {
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
        [videoId, validated.categories]
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


/**
 * Ažurira status videa nakon Mux webhook-a
 * @param {string} uploadId - Mux upload ID
 * @param {Object} muxData - Podaci iz Mux-a
 */
export async function updateVideoFromMuxWebhook(uploadId, muxData) {
    const client = await writePool.connect();
    try {
        await client.query('BEGIN');

        // 1) Nađi video: prvo po uploadId (ako postoji), inače po assetId
        let videoRow;
        if (uploadId) {
            const { rows } = await client.query(
                `SELECT id FROM videos WHERE mux_upload_id = $1 LIMIT 1`,
                [uploadId]
            );
            videoRow = rows[0];
        }
        if (!videoRow && muxData?.assetId) {
            const { rows } = await client.query(
                `SELECT id FROM videos WHERE mux_asset_id = $1 LIMIT 1`,
                [muxData.assetId]
            );
            videoRow = rows[0];
        }
        if (!videoRow) {
            throw new Error(`Video with uploadId=${uploadId ?? '∅'} or assetId=${muxData?.assetId ?? '∅'} not found`);
        }

        const videoId = videoRow.id;

        // 2) Normalizuj asset info
        let assetInfo = null;
        if (muxData?.assetId) {
            assetInfo = await muxService.getAssetInfo(muxData.assetId).catch(() => null);
        }
        // Izvuci playbackId: iz assetInfo ili direktno iz webhooks payload-a
        const playbackId =
            assetInfo?.playbackId ||
            assetInfo?.playback_ids?.[0]?.id ||       // ako tvoj muxService vraća originalni Mux oblik
            muxData?.playbackIds?.[0]?.id || null;

        // 3) Grananje po eventu
        if (muxData.event === 'asset_created') {
            const duration = Math.floor((assetInfo?.duration ?? 0));

            await client.query(
                `
        UPDATE videos
        SET mux_asset_id = $1,
            mux_status  = $2,
            duration_seconds = $3,
            updated_at = NOW()
        WHERE id = $4
        `,
                [muxData.assetId, 'processing', duration, videoId]
            );
        } else if (muxData.event === 'asset_ready') {
            const duration = Math.floor((assetInfo?.duration ?? 0));
            // thumbnail: probaj pomoću playbackId; ako ga nema, probaj assetId
            const thumbSource = playbackId || muxData.assetId;
            const thumbnailUrl = thumbSource ? muxService.getThumbnailUrl(thumbSource) : null;

            await client.query(
                `
        UPDATE videos
        SET mux_asset_id    = COALESCE(mux_asset_id, $1),
            mux_playback_id = COALESCE($2, mux_playback_id),
            mux_status      = 'ready',
            thumbnail_url   = COALESCE($3, thumbnail_url),
            duration_seconds= CASE WHEN $4 IS NOT NULL AND $4 > 0 THEN $4 ELSE duration_seconds END,
            updated_at      = NOW()
        WHERE id = $5
        `,
                [muxData.assetId ?? null, playbackId, thumbnailUrl, duration || null, videoId]
            );
        } else if (muxData.event === 'asset_error') {
            await client.query(
                `
        UPDATE videos
        SET mux_status = 'error',
            updated_at = NOW()
        WHERE id = $1
        `,
                [videoId]
            );
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Video webhook update failed:', err);
        throw err;
    } finally {
        client.release();
    }
}


/**
 * Dohvata video sa svim informacijama
 * @param {string} videoId - ID videa
 * @param {string} userId - ID trenutnog korisnika (za proveru progresa)
 */
export async function getVideoById(videoId, userId = null) {
    const query = `
        SELECT 
            v.id,
            v.mux_playback_id,
            v.title,
            v.description,
            v.thumbnail_url,
            v.duration_seconds,
            v.tags,
            v.view_count,
            v.like_count,
            v.dislike_count,
            v.created_at,
            v.updated_at,
            v.published_at,
            v.chapters,
            v.visibility,
            u.id as uploader_id,
            u.full_name as uploader_name,
            ${userId ? 'wp.progress_seconds, wp.percentage_watched,' : ''}
            ${userId ? 'COALESCE(vr.reaction, 0) as user_reaction,' : ''}
            CASE WHEN v.mux_playback_id IS NOT NULL 
                THEN $2 || v.mux_playback_id || '.m3u8' 
                ELSE NULL 
            END as stream_url
        FROM videos v
        LEFT JOIN users u ON v.uploaded_by = u.id
        ${userId ? 'LEFT JOIN watch_progress wp ON v.id = wp.video_id AND wp.user_id = $3' : ''}
        ${userId ? 'LEFT JOIN video_reactions vr ON v.id = vr.video_id AND vr.user_id = $3' : ''}
        WHERE v.id = $1 AND v.mux_status = 'ready' AND (v.visibility = 'public' OR (v.visibility = 'private' AND v.uploaded_by = $3))
    `;

    const params = [videoId, 'https://stream.mux.com/'];
    if (userId) params.push(userId);

    const { rows } = await readPool.query(query, params);

    if (!rows.length) {
        return null;
    }

    // Inkrementiraj view count
    // if (userId) {
    //     await incrementViewCount(videoId, userId);
    // }

    const catq = `
    SELECT c.id, c.name, c.color
    FROM video_categories vc
    JOIN categories c ON vc.category_id = c.id
    WHERE vc.video_id = $1
  `;
  const { rows: catRows } = await readPool.query(catq, [videoId]);

  const chairq = `
    SELECT 
      p.id,
      p.name,
      p.image_url,
      vc.type,
      COUNT(vc_all.video_id) AS total_video_count
    FROM people p
    JOIN video_chairs vc ON p.id = vc.person_id
    JOIN video_chairs vc_all ON p.id = vc_all.person_id
	  JOIN videos vid ON vc_all.video_id = vid.id
    WHERE vc.video_id = $1 AND vid.mux_status = 'ready' AND vid.visibility = 'public'
    GROUP BY p.id, p.name, p.image_url, vc.type;
    `;
  const { rows: chairRows } = await readPool.query(chairq, [videoId]);

  const playlistq = `
    SELECT
      p.id,
      p.title,
      COALESCE(p.thumbnail_url, fv.first_video_thumbnail_url) AS thumbnail_url,
      p.view_count,
      ic.video_count,
      p.created_at
    FROM public.playlists p
    LEFT JOIN LATERAL (
      SELECT v.thumbnail_url AS first_video_thumbnail_url
      FROM public.playlist_items pi2
      JOIN public.videos v ON v.id = pi2.video_id
      WHERE pi2.playlist_id = p.id
      ORDER BY pi2.position ASC
      LIMIT 1
    ) fv ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS video_count
      FROM public.playlist_items pi3
      WHERE pi3.playlist_id = p.id
    ) ic ON TRUE
    WHERE p.status = 'public'
      AND EXISTS (
        SELECT 1
        FROM public.playlist_items pi
        WHERE pi.playlist_id = p.id
          AND pi.video_id = $1
    );
  `;
  const { rows: playlistRows } = await readPool.query(playlistq, [videoId]);

  const countRes = await readPool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM public.video_comments c
    LEFT JOIN public.video_comments p
      ON p.id = c.parent_id
    WHERE c.video_id = $1
      AND c.is_deleted = false
      AND (
        c.parent_id IS NULL
        OR (p.id IS NOT NULL AND p.is_deleted = false)
      );
    `,
    [videoId]
  );
  const total = countRes.rows[0]?.total || 0;

  rows[0].comment_count = total;
  rows[0].categories = catRows;
  rows[0].people = chairRows;
  rows[0].playlists = playlistRows;
  return rows[0];
}

/**
 * Pretražuje videe
 * @param {Object} searchParams - Parametri pretrage
 */
export async function searchVideos(searchParams, userId = null) {
  const {
    query: searchQuery,
    category,
    tags,
    limit = 20,
    offset = 0,
    sortBy = 'relevance',
    person,
  } = searchParams;

  const params = [];
  let paramCount = 0;

  // Ako postoji userId, stavljamo ga kao prvi parametar (da ga koristimo u JOIN-u)
  let userIdParam = null;
  if (userId) {
    paramCount++;
    params.push(userId);
    userIdParam = paramCount; // npr. $1
  }

  let query = `
    SELECT 
      v.id,
      v.title,
      v.thumbnail_url,
      v.duration_seconds,
      v.view_count,
      v.created_at,
      u.full_name AS uploader_name,
      COALESCE(ppl.people, '[]'::json) AS people
      ${userId ? `, wp.progress_seconds, wp.percentage_watched` : ``}
  `;

  // Relevance scoring kada postoji searchQuery
  let searchParam = null;
  if (searchQuery && searchQuery.trim().length > 0) {
    const trimmedQuery = searchQuery.trim();
    paramCount++;
    params.push(trimmedQuery);
    searchParam = paramCount; // ako userId postoji -> $2, inače -> $1

    query += `,
      GREATEST(
        COALESCE(ts_rank(v.search_vector, plainto_tsquery('english', $${searchParam})) * 2, 0),
        similarity(v.title, $${searchParam}) * 1.5,
        similarity(COALESCE(v.description, ''), $${searchParam}),
        CASE 
          WHEN LOWER(v.title) LIKE LOWER($${searchParam}) || '%' THEN 3.0
          WHEN LOWER(v.title) LIKE '%' || LOWER($${searchParam}) || '%' THEN 2.5
          ELSE 0
        END
      ) AS relevance
    `;
  }

  query += `
    FROM videos v
    LEFT JOIN users u ON v.uploaded_by = u.id
    ${userId ? `LEFT JOIN watch_progress wp ON v.id = wp.video_id AND wp.user_id = $${userIdParam}` : ``}
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'id', p.id,
          'name', p.name,
          'image_url', p.image_url
        )
        ORDER BY p.name
      ) AS people
      FROM (
        SELECT DISTINCT p.id, p.name, p.image_url
        FROM video_chairs vc
        JOIN people p ON p.id = vc.person_id
        WHERE vc.video_id = v.id
      ) p
    ) ppl ON TRUE
    WHERE v.mux_status = 'ready' AND v.visibility = 'public'
      AND v.published_at IS NOT NULL
  `;

  // Enhanced search filter
  if (searchParam) {
    query += ` AND (
      v.search_vector @@ plainto_tsquery('english', $${searchParam})
      OR similarity(v.title, $${searchParam}) > 0.1
      OR similarity(COALESCE(v.description, ''), $${searchParam}) > 0.1
      OR LOWER(v.title) LIKE '%' || LOWER($${searchParam}) || '%'
      OR LOWER(COALESCE(v.description, '')) LIKE '%' || LOWER($${searchParam}) || '%'
    )`;
  }

  // Category filter
  if (category) {
    paramCount++;
    params.push(category);
    query += `
      AND EXISTS (
        SELECT 1
        FROM video_categories vc
        WHERE vc.video_id = v.id
          AND vc.category_id = $${paramCount}
      )
    `;
  }

  // Tags filter
  if (tags && tags.length > 0) {
    paramCount++;
    params.push(tags);
    query += ` AND v.tags && $${paramCount}`;
  }

  // Person filter
  if (person) {
    paramCount++;
    params.push(person);
    query += ` 
      AND EXISTS (
        SELECT 1
        FROM video_chairs vc2
        WHERE vc2.video_id = v.id
          AND vc2.person_id = $${paramCount}
      )
    `;
  }

  // Sorting
  switch (sortBy) {
    case 'relevance':
      if (searchParam) query += ` ORDER BY relevance DESC, v.created_at DESC`;
      else query += ` ORDER BY v.created_at DESC`;
      break;
    case 'date':
      query += ` ORDER BY v.created_at DESC`;
      break;
    case 'views':
      query += ` ORDER BY v.view_count DESC`;
      break;
    case 'likes':
      query += ` ORDER BY v.like_count DESC`;
      break;
    default:
      query += ` ORDER BY v.created_at DESC`;
  }

  // Pagination
  paramCount++;
  params.push(limit);
  query += ` LIMIT $${paramCount}`;

  paramCount++;
  params.push(offset);
  query += ` OFFSET $${paramCount}`;

  const { rows } = await readPool.query(query, params);

  // Count query (ne treba watch_progress)
  let countQuery = `
    SELECT COUNT(*) AS total
    FROM videos v
    WHERE v.mux_status = 'ready' AND v.visibility = 'public'
      AND v.published_at IS NOT NULL
  `;

  const countParams = [];
  let countParamNum = 0;

  if (searchQuery && searchQuery.trim().length > 0) {
    countParamNum++;
    countParams.push(searchQuery.trim());
    countQuery += ` AND (
      v.search_vector @@ plainto_tsquery('english', $${countParamNum})
      OR similarity(v.title, $${countParamNum}) > 0.1
      OR similarity(COALESCE(v.description, ''), $${countParamNum}) > 0.1
      OR LOWER(v.title) LIKE '%' || LOWER($${countParamNum}) || '%'
      OR LOWER(COALESCE(v.description, '')) LIKE '%' || LOWER($${countParamNum}) || '%'
    )`;
  }

  if (category) {
    countParamNum++;
    countParams.push(category);
    countQuery += `
      AND EXISTS (
        SELECT 1
        FROM video_categories vc
        WHERE vc.video_id = v.id
          AND vc.category_id = $${countParamNum}
      )
    `;
  }

  if (tags && tags.length > 0) {
    countParamNum++;
    countParams.push(tags);
    countQuery += ` AND v.tags && $${countParamNum}`;
  }

  if (person) {
    countParamNum++;
    countParams.push(person);
    countQuery += ` 
      AND EXISTS (
        SELECT 1
        FROM video_chairs vc2
        WHERE vc2.video_id = v.id
          AND vc2.person_id = $${countParamNum}
      )
    `;
  }

  const { rows: countRows } = await readPool.query(countQuery, countParams);

  return {
    videos: rows,
    total: parseInt(countRows[0].total, 10),
    limit,
    offset,
  };
}



/**
 * Inkrementiraj view count
 * @param {string} videoId - ID videa
 * @param {string} userId - ID korisnika
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEOIP_DB_PATH = path.resolve(__dirname, '../../../data/GeoLite2-City.mmdb');
const geoReaderPromise = maxmind.open(GEOIP_DB_PATH);

function normalizeIp(ip) {
  if (!ip) return null;

  let value = Array.isArray(ip) ? ip[0] : String(ip);
  value = value.split(',')[0].trim();

  if (value.startsWith('::ffff:')) {
    value = value.slice(7);
  }

  return value || null;
}

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
      country: geo?.country?.names?.en|| null,
      city: geo?.city?.names?.en || null,
    };
  } catch (error) {
    console.error('Local GeoIP lookup failed:', error);
    return { country: null, city: null };
  }
}

export async function incrementViewCount(videoId,{ userId = null, ip = null, userAgent = '' } = {}) {

  const rawIp = normalizeIp(ip);

  // Lookup radi nad sirovim IP-jem, pre hashovanja
  const { country, city } = await getCountryAndCityFromIp(rawIp);

  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const hashedIp = hashIp(ip);

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
      return { view_id,last_seq, counted: false };
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
          city
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, COALESCE(last_seq,0) AS last_seq
      `;
      insertParams = [videoId, userId, hashedIp, userAgent, country, city];
    } else {
      insertQuery = `
        INSERT INTO video_views (
          video_id,
          ip_address,
          user_agent,
          country,
          city
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, COALESCE(last_seq,0) AS last_seq
      `;
      insertParams = [videoId, hashedIp, userAgent, country, city];
    }

    const inserted = await client.query(insertQuery, insertParams);
    const view_id = inserted.rows[0].id;
    const last_seq = inserted.rows[0].last_seq;
    await client.query(
      `UPDATE videos SET view_count = view_count + 1 WHERE id = $1`,
      [videoId]
    );

    await client.query('COMMIT');
    return { view_id,last_seq ,counted: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('View count increment failed:', err);
    throw err; // da caller može da hendluje
  } finally {
    client.release();
  }
}



/**
 * Ažurira progres gledanja
 * @param {string} videoId - ID videa
 * @param {string} userId - ID korisnika
 * @param {number} progressSeconds - Progres u sekundama
 */
export async function updateWatchProgress(videoId, userId, progressSeconds) {
    const query = `
    INSERT INTO watch_progress (
      user_id, video_id, progress_seconds, percentage_watched, last_watched_at
    )
    SELECT
      $1::uuid,
      $2::uuid,
      CASE
        WHEN v.duration_seconds > 0
          THEN LEAST(GREATEST($3::int, 0), v.duration_seconds)
        ELSE GREATEST($3::int, 0)
      END AS progress_seconds,
      CASE
        WHEN v.duration_seconds > 0 THEN
          LEAST(
            100,
            ROUND( (LEAST(GREATEST($4::numeric, 0), v.duration_seconds::numeric)
                   / v.duration_seconds::numeric) * 100, 2 )
          )
        ELSE 0
      END AS percentage_watched,
      NOW()
    FROM videos v
    WHERE v.id = $2::uuid
    ON CONFLICT (user_id, video_id)
    DO UPDATE SET
      progress_seconds = CASE
        WHEN (SELECT duration_seconds FROM videos WHERE id = watch_progress.video_id) > 0
          THEN LEAST(
                 EXCLUDED.progress_seconds,
                 (SELECT duration_seconds FROM videos WHERE id = watch_progress.video_id)
               )
        ELSE EXCLUDED.progress_seconds
      END,
      percentage_watched = CASE
        WHEN (SELECT duration_seconds FROM videos WHERE id = watch_progress.video_id) > 0
          THEN LEAST(
                 100,
                 ROUND(
                   (EXCLUDED.progress_seconds::numeric
                    / (SELECT duration_seconds::numeric FROM videos WHERE id = watch_progress.video_id)) * 100,
                   2
                 )
               )
        ELSE 0
      END,
      last_watched_at = NOW();
  `;

    // $1=userId, $2=videoId, $3=progressSeconds (int), $4=progressSeconds (numeric)
    await writePool.query(query, [userId, videoId, progressSeconds, progressSeconds]);
}



/**
 * Toggle like za video
 * @param {string} videoId - ID videa
 * @param {string} userId - ID korisnika
 * @returns {boolean} Da li je video sada lajkovan
 */
export async function toggleVideoLike(videoId, userId) {
    const client = await writePool.connect();

    try {
        await client.query('BEGIN');

        // Proveri da li like već postoji
        const checkQuery = 'SELECT user_id FROM video_likes WHERE video_id = $1 AND user_id = $2';
        const { rows } = await client.query(checkQuery, [videoId, userId]);

        let isLiked;

        if (rows.length > 0) {
            // Ukloni like
            await client.query(
                'DELETE FROM video_likes WHERE video_id = $1 AND user_id = $2',
                [videoId, userId]
            );

            await client.query(
                'UPDATE videos SET like_count = like_count - 1 WHERE id = $1',
                [videoId]
            );

            isLiked = false;
        } else {
            // Dodaj like
            await client.query(
                'INSERT INTO video_likes (video_id, user_id) VALUES ($1, $2)',
                [videoId, userId]
            );

            await client.query(
                'UPDATE videos SET like_count = like_count + 1 WHERE id = $1',
                [videoId]
            );

            isLiked = true;
        }

        await client.query('COMMIT');
        return isLiked;

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Toggle like failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

export async function getRecommendedVideos(videoId, userId, limit = 10, page = 1) {
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const sql = `
    WITH current_video AS (
      SELECT
        COALESCE(v.tags, '{}')::text[]               AS tags,
        COALESCE(array_agg(vc.category_id), '{}')::uuid[] AS category_ids
      FROM videos v
      LEFT JOIN video_categories vc ON vc.video_id = v.id
      WHERE v.id = $1
      GROUP BY v.id
    ),
    target_cats AS (
      -- categories of each candidate video (array)
      SELECT v.id,
             COALESCE(array_agg(vc.category_id), '{}')::uuid[] AS cats
      FROM videos v
      LEFT JOIN video_categories vc ON vc.video_id = v.id
      GROUP BY v.id
    )
    SELECT
      v.id,
      v.title,
      v.thumbnail_url,
      v.duration_seconds,
      v.view_count,
      v.created_at,
      u.full_name AS uploader_name,
      ${userId ?'wp.progress_seconds,':''}
      ${userId ?'wp.percentage_watched,':''}
      (
        -- tags overlap * 2
        COALESCE(
          array_length(
            ARRAY(
              SELECT DISTINCT t
              FROM unnest(COALESCE(v.tags, '{}')::text[]) AS t
              INTERSECT
              SELECT DISTINCT t2
              FROM unnest(cv.tags) AS t2
            ), 1
          ),
          0
        ) * 2
        +
        -- +3 if any category overlaps
        CASE WHEN tc.cats && cv.category_ids THEN 3 ELSE 0 END
      ) AS similarity_score,
      COALESCE(ppl.people, '[]'::json) AS people
    FROM videos v
    CROSS JOIN current_video cv
    JOIN target_cats tc ON tc.id = v.id
    LEFT JOIN users u ON v.uploaded_by = u.id
    ${userId ?'LEFT JOIN watch_progress wp ON (wp.user_id = $4 AND wp.video_id = v.id)':''}
    LEFT JOIN LATERAL (
                SELECT json_agg(
                        json_build_object(
                        'id', p.id,
                        'name', p.name,
                        'image_url', p.image_url
                        )
                        ORDER BY p.name
                    ) AS people
                FROM (
                SELECT DISTINCT p.id, p.name, p.image_url
                FROM video_chairs vc
                JOIN people p ON p.id = vc.person_id
                WHERE vc.video_id = v.id
                ) p
            ) ppl ON TRUE
    WHERE v.id <> $1
      AND v.mux_status = 'ready' AND v.visibility = 'public'
      AND v.published_at IS NOT NULL
      AND (
        (COALESCE(v.tags, '{}')::text[] && cv.tags)
        OR (tc.cats && cv.category_ids)
      )
    ORDER BY similarity_score DESC, v.view_count DESC
    LIMIT $2 OFFSET $3;
  `;
  const {rows}  = userId? await readPool.query(sql, [videoId, limit, offset,userId]): await readPool.query(sql, [videoId, limit, offset]);
  return rows;
}



export async function getPersonalizedRecommendations(userId, limit = 20, page = 1) {
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const sql = `
    WITH user_cat_interests AS (
      SELECT vc.category_id, COUNT(*) AS interest_score
      FROM watch_progress wp
      JOIN videos v        ON v.id = wp.video_id
      JOIN video_categories vc ON vc.video_id = v.id
      WHERE wp.user_id = $1
        AND wp.percentage_watched >= 0
      GROUP BY vc.category_id
    ),
    user_tag_interests AS (
      SELECT t.tag, COUNT(*) AS interest_score
      FROM watch_progress wp
      JOIN videos v ON v.id = wp.video_id
      CROSS JOIN LATERAL unnest(COALESCE(v.tags, '{}')) AS t(tag)
      WHERE wp.user_id = $1
        AND wp.percentage_watched >= 0
      GROUP BY t.tag
    ),
    scored AS (
      SELECT
        v.id,
        v.title,
        v.thumbnail_url,
        v.duration_seconds,
        v.view_count,
        v.created_at,
        wpp.progress_seconds,
        wpp.percentage_watched,
        u.full_name AS uploader_name,
        (
          COALESCE((
            SELECT SUM(ci.interest_score)
            FROM user_cat_interests ci
            JOIN video_categories vc ON vc.category_id = ci.category_id
            WHERE vc.video_id = v.id
          ), 0) * 3
          +
          COALESCE((
            SELECT SUM(ti.interest_score)
            FROM user_tag_interests ti
            WHERE ti.tag = ANY (COALESCE(v.tags, '{}'))
          ), 0)
        ) AS personal_score,
        COALESCE(ppl.people, '[]'::json) AS people
      FROM videos v
      LEFT JOIN users u ON u.id = v.uploaded_by
      LEFT JOIN watch_progress wpp ON (wpp.user_id=$1 AND wpp.video_id=v.id)
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object('id', p.id, 'name', p.name, 'image_url', p.image_url)
          ORDER BY p.name
        ) AS people
        FROM (
          SELECT DISTINCT p.id, p.name, p.image_url
          FROM video_chairs vc
          JOIN people p ON p.id = vc.person_id
          WHERE vc.video_id = v.id
        ) p
      ) ppl ON TRUE
      WHERE v.mux_status = 'ready' AND v.visibility = 'public'
        AND v.published_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM watch_progress wp2
          WHERE wp2.user_id = $1
            AND wp2.video_id = v.id
            AND wp2.percentage_watched > 30
        )
    )
    SELECT *
    FROM scored
    WHERE personal_score > 4
    ORDER BY personal_score DESC, created_at DESC
    LIMIT $2 OFFSET $3;
  `;

  const { rows } = await readPool.query(sql, [userId, limit, offset]);
  return rows;
}


export async function heartbeatWatchDuration(viewId, { seq, isPlaying = true, userId }) {
  const client = await writePool.connect();
  
  try {
    await client.query('BEGIN');

    if (!viewId) throw new Error('Missing viewId');
    if (!userId) throw new Error('Missing userId');
    
    const s = Number(seq);
    if (!Number.isFinite(s) || s <= 0) throw new Error('Invalid seq');

    const HEARTBEAT_INTERVAL_SEC = 10;
    const MAX_DELTA_SEC = Math.floor(HEARTBEAT_INTERVAL_SEC * 1.5); // 15s

    const { rows } = await client.query(
      `
      WITH prev AS (
        SELECT id, user_id, last_heartbeat_at, last_seq, watch_duration
        FROM video_views
        WHERE id = $1
          AND user_id = $5
        FOR UPDATE
      ),
      calc AS (
        SELECT
          id,
          last_seq,
          CASE
            WHEN $2::boolean IS TRUE THEN
              LEAST(
                GREATEST(
                  EXTRACT(EPOCH FROM (NOW() - COALESCE(last_heartbeat_at, NOW()))),
                  0
                ),
                $4::double precision
              )::bigint
            ELSE 0::bigint
          END AS delta
        FROM prev
      ),
      updated AS (
        UPDATE video_views v
        SET
          watch_duration = COALESCE(v.watch_duration, 0) + c.delta,
          last_heartbeat_at = NOW(),
          last_seq = $3::bigint
        FROM calc c
        WHERE v.id = c.id
          AND (
            c.last_seq IS NULL
            OR $3::bigint = c.last_seq + 1
          )
        RETURNING v.id, v.watch_duration, c.delta AS counted_delta
      )
      SELECT
        u.id,
        u.watch_duration,
        u.counted_delta,
        false AS ignored,
        false AS invalid_seq
      FROM updated u

      UNION ALL

      SELECT
        p.id,
        p.watch_duration,
        0::bigint AS counted_delta,
        true AS ignored,
        CASE
          WHEN p.last_seq IS NOT NULL AND ($3::bigint - p.last_seq) >= 2 THEN true
          ELSE false
        END AS invalid_seq
      FROM prev p
      WHERE NOT EXISTS (SELECT 1 FROM updated)
      `,
      [viewId, isPlaying, s, MAX_DELTA_SEC, userId]
    );


    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return null; // view ne postoji ili nije user-ov
    }

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Heartbeat watch_duration failed:', err);
    throw "Greska";
  } finally {
    client.release();
  }
}

export async function setVideoReaction(videoId, userId, reaction) {
  // reaction: "like" | "dislike"
  const client = await writePool.connect();
  const newVal = reaction === "like" ? 1 : -1;

  try {
    await client.query("BEGIN");

    // Zaključaj red u tabeli reakcija (ako postoji) radi sigurnosti u konkurenciji
    const { rows } = await client.query(
      `SELECT reaction
       FROM video_reactions
       WHERE video_id = $1 AND user_id = $2
       FOR UPDATE`,
      [videoId, userId]
    );

    let status; // "liked" | "disliked" | "none"

    if (rows.length === 0) {
      // Nema reakcije -> upiši novu
      await client.query(
        `INSERT INTO video_reactions (video_id, user_id, reaction)
         VALUES ($1, $2, $3)`,
        [videoId, userId, newVal]
      );

      if (newVal === 1) {
        await client.query(`UPDATE videos SET like_count = like_count + 1 WHERE id = $1`, [videoId]);
        status = 1;
      } else {
        await client.query(`UPDATE videos SET dislike_count = dislike_count + 1 WHERE id = $1`, [videoId]);
        status = -1;
      }

    } else {
      const oldVal = rows[0].reaction;

      if (oldVal === newVal) {
        // Kliknuo isto dugme opet -> toggle OFF (skloni reakciju)
        await client.query(
          `DELETE FROM video_reactions WHERE video_id = $1 AND user_id = $2`,
          [videoId, userId]
        );

        if (newVal === 1) {
          await client.query(`UPDATE videos SET like_count = like_count - 1 WHERE id = $1`, [videoId]);
        } else {
          await client.query(`UPDATE videos SET dislike_count = dislike_count - 1 WHERE id = $1`, [videoId]);
        }

        status = 0;
      } else {
        // Prebacio sa like -> dislike ili obrnuto
        await client.query(
          `UPDATE video_reactions SET reaction = $3 WHERE video_id = $1 AND user_id = $2`,
          [videoId, userId, newVal]
        );

        if (newVal === 1) {
          // dislike -> like
          await client.query(
            `UPDATE videos
             SET like_count = like_count + 1,
                 dislike_count = dislike_count - 1
             WHERE id = $1`,
            [videoId]
          );
          status = 1;
        } else {
          // like -> dislike
          await client.query(
            `UPDATE videos
             SET dislike_count = dislike_count + 1,
                 like_count = like_count - 1
             WHERE id = $1`,
            [videoId]
          );
          status = -1;
        }
      }
    }

    await client.query("COMMIT");
    return { status }; // status ti kaže šta sad važi
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}





