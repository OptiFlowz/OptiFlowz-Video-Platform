// videoService.js
import {  readPool,writePool } from '../../database/index.js';
import crypto from "crypto";

import { logEvent } from '../../common/logger.js';

function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT; // stavi neki random string u env
  return crypto.createHmac("sha256", salt).update(ip).digest("hex");
}

export async function getPlaylistWithVideos(playlistId, userId = null) {
  const sql = `
    SELECT
      p.id,
      p.title,
      p.description,
      COALESCE(p.thumbnail_url, fv.first_video_thumbnail_url) AS thumbnail_url,
      p.view_count,
      p.save_count,
      COALESCE(ic.video_count, 0)::int AS video_count,
      p.created_at,
      p.tags,
      p.featured,
      ${userId ? `
        EXISTS (
          SELECT 1
          FROM public.playlist_saves ps
          WHERE ps.playlist_id = p.id
            AND ps.user_id = $2
        ) AS is_saved,
      ` : `FALSE AS is_saved,`}
      COALESCE(vs.videos, '[]'::json) AS videos
    FROM public.playlists p

    LEFT JOIN LATERAL (
      SELECT v.thumbnail_url AS first_video_thumbnail_url
      FROM public.playlist_items pi
      JOIN public.videos v ON v.id = pi.video_id
      WHERE pi.playlist_id = p.id
        AND v.mux_status = 'ready'
        AND v.published_at IS NOT NULL
      ORDER BY pi.position ASC
      LIMIT 1
    ) fv ON TRUE

    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS video_count
      FROM public.playlist_items pi
      JOIN public.videos v ON v.id = pi.video_id
      WHERE pi.playlist_id = p.id
        AND v.mux_status = 'ready'
        AND v.published_at IS NOT NULL
    ) ic ON TRUE

    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'id', v.id,
          'title', v.title,
          'thumbnail_url', v.thumbnail_url,
          'duration_seconds', v.duration_seconds,
          'view_count', v.view_count,
          'created_at', v.created_at,
          'progress_seconds', ${userId ? "wp.progress_seconds" : "NULL"},
          'percentage_watched', ${userId ? "wp.percentage_watched" : "NULL"},
          'uploader_name', u.full_name,
          'people', COALESCE(ppl.people, '[]'::json)
        )
        ORDER BY pi.position ASC
      ) AS videos
      FROM public.playlist_items pi
      JOIN public.videos v ON v.id = pi.video_id
      LEFT JOIN public.users u ON u.id = v.uploaded_by
      ${userId ? "LEFT JOIN public.watch_progress wp ON (wp.user_id = $2 AND wp.video_id = v.id)" : ""}
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', p2.id,
            'name', p2.name,
            'image_url', p2.image_url
          )
          ORDER BY p2.name
        ) AS people
        FROM (
          SELECT DISTINCT p2.id, p2.name, p2.image_url
          FROM public.video_chairs vc
          JOIN public.people p2 ON p2.id = vc.person_id
          WHERE vc.video_id = v.id
        ) p2
      ) ppl ON TRUE
      WHERE pi.playlist_id = p.id
        AND v.mux_status = 'ready'
        AND v.published_at IS NOT NULL
    ) vs ON TRUE

    WHERE p.id = $1
    LIMIT 1;
  `;

  const params = userId ? [playlistId, userId] : [playlistId];
  const { rows } = await readPool.query(sql, params);

  return rows[0] || null;
}


export async function incrementViewCount(playlistId,{ userId = null, ip = null, userAgent = '' } = {}) {
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

    await client.query(
      `UPDATE playlists SET view_count = view_count + 1 WHERE id = $1`,
      [playlistId]
    );

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


export async function searchPlaylists(searchParams) {
  const {
    query: searchQuery,
    tags,
    limit = 20,
    offset = 0,
    sortBy = "relevance",
  } = searchParams;

  const params = [];
  let paramCount = 0;

  let query = `
    SELECT
      p.id,
      p.title,
      p.description,
      COALESCE(p.thumbnail_url, fv.first_video_thumbnail_url) AS thumbnail_url,
      p.view_count,
      ic.video_count,
      p.created_at
  `;

  // Relevance scoring (ako postoji q)
  let searchParam = null;
  if (searchQuery && searchQuery.trim().length > 0) {
    const trimmedQuery = searchQuery.trim();
    paramCount++;
    params.push(trimmedQuery);
    searchParam = paramCount;

    query += `,
      GREATEST(
        COALESCE(ts_rank(p.search_vector, plainto_tsquery('english', $${searchParam})) * 2, 0),
        similarity(p.title, $${searchParam}) * 1.5,
        similarity(COALESCE(p.description, ''), $${searchParam}),
        CASE
          WHEN LOWER(p.title) LIKE LOWER($${searchParam}) || '%' THEN 3.0
          WHEN LOWER(p.title) LIKE '%' || LOWER($${searchParam}) || '%' THEN 2.5
          ELSE 0
        END
      ) AS relevance
    `;
  }

  query += `
    FROM public.playlists p
    LEFT JOIN LATERAL (
      SELECT v.thumbnail_url AS first_video_thumbnail_url
      FROM public.playlist_items pi2
      JOIN public.videos v ON v.id = pi2.video_id
      WHERE pi2.playlist_id = p.id
        AND v.mux_status = 'ready'
        AND v.published_at IS NOT NULL
      ORDER BY pi2.position ASC
      LIMIT 1
    ) fv ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS video_count
      FROM public.playlist_items pi3
      JOIN public.videos v3 ON v3.id = pi3.video_id
      WHERE pi3.playlist_id = p.id
        AND v3.mux_status = 'ready'
        AND v3.published_at IS NOT NULL
    ) ic ON TRUE
    WHERE p.status = 'public'
      AND EXISTS (
        SELECT 1
        FROM public.playlist_items pi_exist
        JOIN public.videos v_exist ON v_exist.id = pi_exist.video_id
        WHERE pi_exist.playlist_id = p.id
          AND v_exist.mux_status = 'ready'
          AND v_exist.published_at IS NOT NULL
      )
  `;

  // Search filter
  if (searchParam) {
    query += ` AND (
      p.search_vector @@ plainto_tsquery('english', $${searchParam})
      OR similarity(p.title, $${searchParam}) > 0.1
      OR similarity(COALESCE(p.description, ''), $${searchParam}) > 0.1
      OR LOWER(p.title) LIKE '%' || LOWER($${searchParam}) || '%'
      OR LOWER(COALESCE(p.description, '')) LIKE '%' || LOWER($${searchParam}) || '%'
    )`;
  }

  // Tags filter (ako imaš p.tags kao text[])
  if (tags && tags.length > 0) {
    paramCount++;
    params.push(tags);
    query += ` AND p.tags && $${paramCount}`;
  }

  // Sorting
  switch (sortBy) {
    case "relevance":
      if (searchParam) query += ` ORDER BY relevance DESC, p.created_at DESC`;
      else query += ` ORDER BY p.created_at DESC`;
      break;
    case "date":
      query += ` ORDER BY p.created_at DESC`;
      break;
    case "views":
      query += ` ORDER BY p.view_count DESC`;
      break;
    case "videos":
      query += ` ORDER BY ic.video_count DESC, p.created_at DESC`;
      break;
    default:
      query += ` ORDER BY p.created_at DESC`;
  }

  // Pagination
  paramCount++;
  params.push(limit);
  query += ` LIMIT $${paramCount}`;

  paramCount++;
  params.push(offset);
  query += ` OFFSET $${paramCount}`;

  const { rows } = await readPool.query(query, params);

  // COUNT query (bez lateral joinova)
  let countQuery = `
    SELECT COUNT(*) AS total
    FROM public.playlists p
    WHERE p.status = 'public'
      AND EXISTS (
        SELECT 1
        FROM public.playlist_items pi_exist
        JOIN public.videos v_exist ON v_exist.id = pi_exist.video_id
        WHERE pi_exist.playlist_id = p.id
          AND v_exist.mux_status = 'ready'
          AND v_exist.published_at IS NOT NULL
      )
  `;

  const countParams = [];
  let countParamNum = 0;

  if (searchQuery && searchQuery.trim().length > 0) {
    countParamNum++;
    countParams.push(searchQuery.trim());
    countQuery += ` AND (
      p.search_vector @@ plainto_tsquery('english', $${countParamNum})
      OR similarity(p.title, $${countParamNum}) > 0.1
      OR similarity(COALESCE(p.description, ''), $${countParamNum}) > 0.1
      OR LOWER(p.title) LIKE '%' || LOWER($${countParamNum}) || '%'
      OR LOWER(COALESCE(p.description, '')) LIKE '%' || LOWER($${countParamNum}) || '%'
    )`;
  }

  if (tags && tags.length > 0) {
    countParamNum++;
    countParams.push(tags);
    countQuery += ` AND p.tags && $${countParamNum}`;
  }

  const { rows: countRows } = await readPool.query(countQuery, countParams);

  return {
    playlists: rows,
    total: parseInt(countRows[0]?.total ?? "0", 10),
    limit,
    offset,
  };
}

export async function togglePlaylistSave(playlistId, userId) {
  const client = await writePool.connect();

  try {
    await client.query("BEGIN");

    // 1) pokušaj INSERT (save)
    const insertRes = await client.query(
      `
      INSERT INTO public.playlist_saves (user_id, playlist_id, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, playlist_id) DO NOTHING
      RETURNING 1;
      `,
      [userId, playlistId]
    );

    let saved;

    if (insertRes.rowCount === 1) {
      // SAVE uspeo -> increment save_count
      saved = true;

      const upd = await client.query(
        `
        UPDATE public.playlists
        SET save_count = COALESCE(save_count, 0) + 1
        WHERE id = $1
        RETURNING save_count;
        `,
        [playlistId]
      );

      if (upd.rowCount === 0) {
        // playlist ne postoji -> rollback + obriši save koji smo ubacili
        throw new Error("PLAYLIST_NOT_FOUND");
      }

      await client.query("COMMIT");
      return { saved: true, save_count: upd.rows[0].save_count };
    }

    // 2) ako INSERT nije uspeo (već postoji), uradi DELETE (unsave)
    const delRes = await client.query(
      `
      DELETE FROM public.playlist_saves
      WHERE user_id = $1 AND playlist_id = $2
      RETURNING 1;
      `,
      [userId, playlistId]
    );

    // Ako iz nekog razloga nema reda (edge-case), tretiraj kao "nije saved"
    if (delRes.rowCount === 0) {
      await client.query("COMMIT");
      return { saved: false, save_count: null };
    }

    saved = false;

    const upd2 = await client.query(
      `
      UPDATE public.playlists
      SET save_count = GREATEST(COALESCE(save_count, 0) - 1, 0)
      WHERE id = $1
      RETURNING save_count;
      `,
      [playlistId]
    );

    if (upd2.rowCount === 0) {
      throw new Error("PLAYLIST_NOT_FOUND");
    }

    await client.query("COMMIT");
    return { saved: false, save_count: upd2.rows[0].save_count };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getFeaturedPlaylists() {
  const sql = `
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
      AND p.featured = TRUE
    ORDER BY p.created_at ASC;
  `;

  const { rows } = await readPool.query(sql);
  return { playlists: rows };
}

export async function getSavedPlaylists(userId, { limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(parseInt(limit, 10) || 50, 100);
  const safeOffset = parseInt(offset, 10) || 0;

  const query = `
    SELECT
      p.id,
      p.title,
      COALESCE(p.thumbnail_url, fv.first_video_thumbnail_url) AS thumbnail_url,
      p.view_count,
      ic.video_count,
      p.created_at
    FROM public.playlist_saves sp
    JOIN public.playlists p ON p.id = sp.playlist_id
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
    WHERE sp.user_id = $1
      AND p.status = 'public'
    ORDER BY sp.created_at DESC
    LIMIT $2 OFFSET $3;
  `;

  const { rows } = await readPool.query(query, [userId, safeLimit, safeOffset]);
  return { playlists: rows, limit: safeLimit, offset: safeOffset };
}
