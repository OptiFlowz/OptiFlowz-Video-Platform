import { readPool, writePool } from '../../database/index.js';
import multer from "multer";
import { z } from "zod";
import { s3 } from "../storage/r2.client.js";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import sharp from "sharp";

export async function handleGetMyPlaylists(req, res) {
  try {
    const userId = req.user?.sub || null;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const offset = (page - 1) * limit;

    const sort = String(req.query.sort || "created_at").toLowerCase();
    const order = String(req.query.order || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    // whitelist sort kolona (da nema SQL injection)
    const sortCol =
      sort === "view_count" ? "p.view_count" :
      sort === "save_count" ? "p.save_count" :
      "p.created_at";

    const orderBy = `${sortCol} ${order}, p.created_at DESC`;

    const countRes = await readPool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM public.playlists p
      WHERE p.created_by = $1
      `,
      [userId]
    );
    const total = countRes.rows[0]?.total || 0;

    const { rows } = await readPool.query(
      `
      SELECT
        p.id,
        p.title,
        COALESCE(p.thumbnail_url, fv.first_video_thumbnail_url) AS thumbnail_url,
        p.view_count,
        p.save_count,
        ic.video_count,
        p.created_at,
        p.status,
        p.featured,
        p.description
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
      WHERE p.created_by = $1
      ORDER BY ${orderBy}
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    return res.json({
      success: true,
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      sort: sortCol.replace("p.", ""),
      order: order.toLowerCase(),
      playlists: rows,
    });
  } catch (err) {
    console.error("handleGetMyPlaylists error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}




// koristi iste helper funkcije koje već imaš:
function isDefined(v) {
  return v !== undefined;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return null;
  const cleaned = [...new Set(tags.map((x) => String(x).trim()).filter(Boolean))];
  return cleaned;
}

export async function handlePatchPlaylistDetails(req, res) {
  const { playlistId } = req.params;

  const {
    title,
    description,
    tags,
    status,   // "public" | "private"  (null -> private)
    featured, // boolean
  } = req.body || {};

  // status validacija + null -> private
  let statusNorm = undefined;
  if (isDefined(status)) {
    statusNorm = status === null ? "private" : String(status).toLowerCase();
    if (statusNorm !== "public" && statusNorm !== "private") {
      return res
        .status(400)
        .json({ message: "status must be 'public' or 'private' (or null -> private)" });
    }
  }

  // featured validacija (dozvoli null da obriše)
  if (isDefined(featured) && typeof featured !== "boolean") {
    return res.status(400).json({ message: "featured must be boolean" });
  }

  // tags normalizacija (null -> brisanje)
  const normTags = isDefined(tags) ? (tags === null ? null : normalizeTags(tags)) : undefined;
  if (isDefined(tags) && tags !== null && normTags === null) {
    return res.status(400).json({ message: "tags must be an array of strings or null" });
  }

  const anyField =
    isDefined(title) ||
    isDefined(description) ||
    isDefined(tags) ||
    isDefined(status) ||
    isDefined(featured);

  if (!anyField) {
    return res.status(400).json({ message: "No fields provided" });
  }

  const client = await writePool.connect();
  try {
    await client.query("BEGIN");

    const set = [];
    const params = [playlistId];
    let i = 2;

    // title: null => NULL, string => value
    if (isDefined(title)) {
      if (title === null) {
        set.push(`title = NULL`);
      } else {
        set.push(`title = $${i++}`);
        params.push(String(title).trim());
      }
    }

    // description: null => NULL, string => value
    if (isDefined(description)) {
      set.push(`description = $${i++}`);
      params.push(description === null ? null : String(description));
    }

    // tags: null => NULL, array => text[]
    if (isDefined(tags)) {
      if (tags === null) {
        set.push(`tags = NULL`);
      } else {
        set.push(`tags = $${i++}::text[]`);
        params.push(normTags);
      }
    }

    // status: null -> private (ne NULL)
    if (isDefined(status)) {
      set.push(`status = $${i++}`);
      params.push(statusNorm);
    }

    // featured: null -> NULL, boolean -> value
    if (isDefined(featured)) {
      if (featured === null) {
        set.push(`featured = NULL`);
      } else {
        set.push(`featured = $${i++}`);
        params.push(featured);
      }
    }

    set.push(`updated_at = NOW()`);

    const sql = `
      UPDATE public.playlists
      SET ${set.join(", ")}
      WHERE id = $1
      RETURNING id
    `;

    const r = await client.query(sql, params);
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Playlist not found" });
    }

    await client.query("COMMIT");
    return res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("update playlist error:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
}





const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");

// multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});
export const playlistThumbnailUploadMiddleware = upload.single("file");

// zod file validation
const fileSchema = z.object({
  mimetype: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(5 * 1024 * 1024),
});

// Helper: izvuci key iz URL-a ako je URL naš
function extractKeyFromPublicUrl(url) {
  if (!url || !R2_PUBLIC_BASE_URL) return null;
  if (!url.startsWith(R2_PUBLIC_BASE_URL + "/")) return null;
  return url.slice((R2_PUBLIC_BASE_URL + "/").length);
}

export async function handlePlaylistThumbnailUpload(req, res) {
  try {
    const playlistId = req.params.playlistId;
    if (!playlistId) return res.status(400).json({ message: "Missing playlistId" });

    if (!R2_PUBLIC_BASE_URL) {
      return res.status(500).json({
        message: "R2_PUBLIC_BASE_URL is not set",
      });
    }

    // 1) Učitaj stari thumbnail_url iz baze
    const existing = await writePool.query(
      `SELECT thumbnail_url FROM public.playlists WHERE id = $1 LIMIT 1`,
      [playlistId]
    );

    if (!existing.rowCount) {
      return res.status(404).json({ message: "Playlist not found" });
    }

    const oldUrl = existing.rows[0]?.thumbnail_url || null;
    const oldKey = extractKeyFromPublicUrl(oldUrl);

    // ✅ Ako fajl NIJE poslat -> remove thumbnail
    if (!req.file) {
      const upd = await writePool.query(
        `
        UPDATE public.playlists
        SET thumbnail_url = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING id, thumbnail_url
        `,
        [playlistId]
      );

      if (oldKey) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey }));
        } catch (e) {
          console.warn("Playlist thumbnail delete failed:", e?.message || e);
        }
      }

      return res.json({ success: true, playlist: upd.rows[0] });
    }

    // 2) Validacija fajla
    const parsedFile = fileSchema.safeParse({
      mimetype: req.file.mimetype,
      size: req.file.size,
    });
    if (!parsedFile.success) {
      return res.status(400).json({
        message: "Invalid file",
        errors: parsedFile.error.flatten(),
      });
    }

    // 3) Obrada slike (thumbnail je obično 16:9)
    //    - cover: napravi lep crop
    //    - 1280x720 je super za thumbnails
    const inputBuffer = req.file.buffer;

    const compressedBuffer = await sharp(inputBuffer)
      .rotate()
      .resize({
        width: 1280,
        height: 720,
        fit: "cover",
        position: "center",
      })
      .webp({ quality: 82 })
      .toBuffer();

    // 4) Upload u R2
    const newKey = `playlist-thumbnails/${playlistId}/${randomUUID()}.webp`;
    const newUrl = `${R2_PUBLIC_BASE_URL}/${newKey}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: newKey,
        Body: compressedBuffer,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );

    // 5) Update DB
    const upd = await writePool.query(
      `
      UPDATE public.playlists
      SET thumbnail_url = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, thumbnail_url
      `,
      [playlistId, newUrl]
    );

    // 6) Obriši stari thumbnail (best-effort)
    if (oldKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey }));
      } catch (e) {
        console.warn("Old playlist thumbnail delete failed:", e?.message || e);
      }
    }

    return res.json({ success: true, playlist: upd.rows[0] });
  } catch (err) {
    console.error("Playlist thumbnail upload error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}


function toIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function addVideoToPlaylist(req, res) {
  const playlistId = req.params.playlistId;
  const videoId = req.body?.video_id;
  const position = toIntOrNull(req.body?.position); // optional

  if (!playlistId || !videoId) {
    return res.status(400).json({ message: "playlistId and video_id are required" });
  }

  const client = await writePool.connect();
  try {
    await client.query("BEGIN");

    // (opciono) proveri da playlist postoji
    const pl = await client.query(`SELECT id FROM public.playlists WHERE id = $1 LIMIT 1`, [playlistId]);
    if (!pl.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Playlist not found" });
    }

    // (opciono) proveri da video postoji
    const v = await client.query(`SELECT id FROM public.videos WHERE id = $1 LIMIT 1`, [videoId]);
    if (!v.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Video not found" });
    }

    // već u playlisti?
    const exists = await client.query(
      `SELECT 1 FROM public.playlist_items WHERE playlist_id = $1 AND video_id = $2 LIMIT 1`,
      [playlistId, videoId]
    );
    if (exists.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Video already in playlist" });
    }

    // odredi target poziciju
    let targetPos = position;

    const maxRes = await client.query(
      `SELECT COALESCE(MAX(position), 0)::int AS max_pos
       FROM public.playlist_items
       WHERE playlist_id = $1`,
      [playlistId]
    );
    const maxPos = maxRes.rows[0].max_pos;

    if (targetPos === null) {
      targetPos = maxPos + 1; // na kraj
    } else {
      // clamp u opseg 1..maxPos+1
      if (targetPos < 1) targetPos = 1;
      if (targetPos > maxPos + 1) targetPos = maxPos + 1;

      // pomeri postojeće na >= targetPos
      await client.query(
        `
        -- 1) u privremenu zonu
        UPDATE public.playlist_items
        SET position = position + 100000
        WHERE playlist_id = $1 AND position >= $2
        `,
        [playlistId, targetPos]
      );

      await client.query(
        `
        -- 2) vrati iz privremene zone na final (+1)
        UPDATE public.playlist_items
        SET position = position - 99999
        WHERE playlist_id = $1 AND position >= $2 + 100000
        `,
        [playlistId, targetPos]
      );
    }

    await client.query(
      `
      INSERT INTO public.playlist_items (playlist_id, video_id, position)
      VALUES ($1, $2, $3)
      `,
      [playlistId, videoId, targetPos]
    );

    await client.query("COMMIT");
    return res.status(201).json({
      success: true,
      playlist_id: playlistId,
      video_id: videoId,
      position: targetPos,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // unique constraint fallback
    if (err?.code === "23505") {
      return res.status(409).json({ message: "Duplicate playlist item (video or position)" });
    }
    console.error("addVideoToPlaylist error:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
}


export async function removeVideoFromPlaylist(req, res) {
  const { playlistId, videoId } = req.params;

  if (!playlistId || !videoId) {
    return res.status(400).json({ message: "playlistId and videoId are required" });
  }

  const client = await writePool.connect();
  try {
    await client.query("BEGIN");

    // Nađi poziciju
    const itemRes = await client.query(
      `
      SELECT position
      FROM public.playlist_items
      WHERE playlist_id = $1 AND video_id = $2
      LIMIT 1
      `,
      [playlistId, videoId]
    );

    if (!itemRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Item not found in playlist" });
    }

    const oldPos = itemRes.rows[0].position;

    // Obriši item
    await client.query(
      `DELETE FROM public.playlist_items WHERE playlist_id = $1 AND video_id = $2`,
      [playlistId, videoId]
    );

    // SAFE shift: svi posle oldPos pomeri -1 (2-step)
    await client.query(
      `
      UPDATE public.playlist_items
      SET position = position + 100000
      WHERE playlist_id = $1 AND position > $2
      `,
      [playlistId, oldPos]
    );

    await client.query(
      `
      UPDATE public.playlist_items
      SET position = position - 100001
      WHERE playlist_id = $1 AND position >= 100000
      `,
      [playlistId]
    );

    await client.query("COMMIT");
    return res.json({ success: true, playlist_id: playlistId, video_id: videoId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("removeVideoFromPlaylist error:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
}


function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export async function movePlaylistItem(req, res) {
  const { playlistId } = req.params;
  const videoId = req.body?.video_id;
  const toPosRaw = Number(req.body?.to_position);

  if (!playlistId || !videoId) {
    return res.status(400).json({ message: "playlistId and video_id are required" });
  }
  if (!Number.isFinite(toPosRaw)) {
    return res.status(400).json({ message: "to_position must be a number" });
  }

  const client = await writePool.connect();
  try {
    await client.query("BEGIN");

    // (Opcionalno) zaključaš listu da nema race condition
    // await client.query(`SELECT 1 FROM public.playlist_items WHERE playlist_id = $1 FOR UPDATE`, [playlistId]);

    // current position
    const curRes = await client.query(
      `
      SELECT position
      FROM public.playlist_items
      WHERE playlist_id = $1 AND video_id = $2
      LIMIT 1
      `,
      [playlistId, videoId]
    );

    if (!curRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Item not found in playlist" });
    }

    const fromPos = curRes.rows[0].position;

    // max position
    const maxRes = await client.query(
      `
      SELECT COALESCE(MAX(position), 0)::int AS max_pos
      FROM public.playlist_items
      WHERE playlist_id = $1
      `,
      [playlistId]
    );
    const maxPos = maxRes.rows[0].max_pos;
    const tempPos = maxPos + 100000;

    const toPos = clamp(Math.trunc(toPosRaw), 1, maxPos);

    if (toPos === fromPos) {
      await client.query("COMMIT");
      return res.json({ success: true, playlist_id: playlistId, video_id: videoId, from: fromPos, to: toPos });
    }

    // 1) privremeno oslobodi poziciju: stavi target item u "temp zonu"
    await client.query(
      `
      UPDATE public.playlist_items
      SET position = $3
      WHERE playlist_id = $1 AND video_id = $2
      `,
      [playlistId, videoId, tempPos]
    );

    if (fromPos < toPos) {
      // moving DOWN:
      // items in (fromPos+1 .. toPos) shift -1
      await client.query(
        `
        UPDATE public.playlist_items
        SET position = position + 100000
        WHERE playlist_id = $1
          AND position BETWEEN $2 AND $3
        `,
        [playlistId, fromPos + 1, toPos]
      );

      await client.query(
        `
        UPDATE public.playlist_items
        SET position = position - 100001
        WHERE playlist_id = $1
          AND position BETWEEN $2 AND $3
        `,
        [playlistId, fromPos + 1 + 100000, toPos + 100000]
      );
    } else {
      // moving UP:
      // items in (toPos .. fromPos-1) shift +1
      await client.query(
        `
        UPDATE public.playlist_items
        SET position = position + 100000
        WHERE playlist_id = $1
          AND position BETWEEN $2 AND $3
        `,
        [playlistId, toPos, fromPos - 1]
      );

      await client.query(
        `
        UPDATE public.playlist_items
        SET position = position - 99999
        WHERE playlist_id = $1
          AND position BETWEEN $2 AND $3
        `,
        [playlistId, toPos + 100000, fromPos - 1 + 100000]
      );
    }

    // 3) stavi target item na toPos
    await client.query(
      `
      UPDATE public.playlist_items
      SET position = $3
      WHERE playlist_id = $1 AND video_id = $2
      `,
      [playlistId, videoId, toPos]
    );

    await client.query("COMMIT");
    return res.json({ success: true, playlist_id: playlistId, video_id: videoId, from: fromPos, to: toPos });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "23505") {
      return res.status(409).json({ message: "Position conflict (unique constraint)" });
    }
    console.error("movePlaylistItem error:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
}



export async function reorderPlaylistItems(req, res) {
  const playlistId = req.params.playlistId;
  const ordered = req.body?.ordered_video_ids;

  if (!playlistId) return res.status(400).json({ message: "Missing playlistId" });
  if (!Array.isArray(ordered) || ordered.length === 0) {
    return res.status(400).json({ message: "ordered_video_ids must be a non-empty array" });
  }

  // dedupe + basic sanitize
  const ids = ordered.map((x) => String(x).trim()).filter(Boolean);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) {
    return res.status(400).json({ message: "ordered_video_ids contains duplicates" });
  }

  const client = await writePool.connect();
  try {
    await client.query("BEGIN");

    // proveri da svi pripadaju toj playlisti i da nemaš “višak/manjak”
    const dbRes = await client.query(
      `SELECT video_id::text
       FROM public.playlist_items
       WHERE playlist_id = $1`,
      [playlistId]
    );

    const dbIds = dbRes.rows.map((r) => r.video_id);
    const dbSet = new Set(dbIds);

    // 1) svaki prosleđeni mora biti u playlisti
    for (const vid of unique) {
      if (!dbSet.has(vid)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "ordered_video_ids contains a video that is not in this playlist",
          video_id: vid,
        });
      }
    }

    // 2) moraš poslati SVE iteme (da ne ostane neki bez pozicije)
    if (unique.length !== dbIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "ordered_video_ids must include all videos currently in the playlist",
        expected_count: dbIds.length,
        got_count: unique.length,
      });
    }

    // UPDATE pozicija na osnovu ordinality
    await client.query(
      `
      WITH ord AS (
        SELECT video_id::uuid, ord::int AS pos
        FROM unnest($2::uuid[]) WITH ORDINALITY AS t(video_id, ord)
      )
      UPDATE public.playlist_items pi
      SET position = ord.pos
      FROM ord
      WHERE pi.playlist_id = $1
        AND pi.video_id = ord.video_id
      `,
      [playlistId, unique]
    );

    await client.query("COMMIT");
    return res.json({ success: true, playlist_id: playlistId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "23505") {
      return res.status(409).json({ message: "Position conflict (unique constraint)" });
    }
    console.error("reorderPlaylistItems error:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
}


export async function handleDeletePlaylist(req, res) {
  try {
    const userId = req.user?.sub || null;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const playlistId = req.params.playlistId;

    if (!playlistId) {
      return res.status(400).json({ message: "playlistId is required" });
    }

    const result = await writePool.query(
      `
      DELETE 
      FROM public.playlists
      WHERE id=$1 AND created_by=$2
      `,
      [playlistId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found or you do not have permission to delete it",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Playlist deleted successfully",
      deletedId: playlistId,
    });
  } catch (err) {
    console.error("create playlist error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

export async function handleCreatePlaylist(req, res) {
  try {
    const userId = req.user?.sub || null;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const title = String(req.body?.title ?? "").trim();
    if (!title) {
      return res.status(400).json({ message: "title is required" });
    }

    const { rows } = await writePool.query(
      `
      INSERT INTO public.playlists (title, created_by, status)
      VALUES ($1, $2, 'private')
      RETURNING id, title, status, created_at
      `,
      [title, userId]
    );

    return res.status(201).json({ success: true, playlist: rows[0] });
  } catch (err) {
    console.error("create playlist error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}