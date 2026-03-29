// videoRoutes.js
import {  readPool,writePool } from '../../database/index.js';
import * as videoService from './video.service.js';
import { generateChapters } from "@mux/ai/workflows";
import Mux from "@mux/mux-node";
import crypto from "crypto";


import { logEvent } from '../../common/logger.js';




const mux = new Mux({
    tokenId: process.env.MUX_TOKEN_ID,
    tokenSecret: process.env.MUX_TOKEN_SECRET,
});

export async function handleInitiateUpload(req, res) {
    const userId = req.user?.sub || null;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const title = String(req.body?.title ?? "").trim();
    const languageCode = String(req.body?.language_code ?? "en").trim().toLowerCase();
    const languageName = String(req.body?.language_name ?? "English").trim();

    if (!title) {
        return res.status(400).json({ message: "title is required" });
    }

    // (Opcionalno) minimalna validacija - Mux podržava dosta kodova, ali makar spreči prazno
    if (!languageCode) {
        return res.status(400).json({ message: "language_code must be non-empty" });
    }

    const client = await writePool.connect();
    try {
        await client.query("BEGIN");

        const insertSql = `
            INSERT INTO public.videos (title, uploaded_by)
            VALUES ($1, $2)
            RETURNING id
            `;
        const { rows: createdRows } = await client.query(insertSql, [title, userId]);
        const videoId = createdRows[0]?.id;

        // 2) Kreiraj Mux direct upload sa auto captions
        const upload = await mux.video.uploads.create({
            cors_origin: "*",
            new_asset_settings: {
                playback_policies: ["public"],
                encoding_tier: "baseline",
                normalize_audio: false,
                inputs: [
                    {
                        generated_subtitles: [
                            {
                                language_code: languageCode, 
                                name: languageName,
                            },
                        ],
                    },
                ],

                meta: {
                    title,
                    external_id: String(videoId),
                    creator_id: String(userId),
                },
                passthrough: String(videoId),
            },
        });


        await client.query(
           `UPDATE public.videos SET mux_upload_id = $1 WHERE id = $2`,
           [upload.id, videoId]
        );

        await client.query("COMMIT");

        return res.json({
            video_id: videoId,
            upload: {
                upload_id: upload.id,
                upload_url: upload.url,
            },
        });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch { }
        console.error("upload initiate error:", err);
        return res.status(500).json({ message: "Server error" });
    } finally {
        client.release();
    }
}

export async function handleHeartbeat(req, res) {
    try {
        const userId = req.user?.sub || null;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const { view_id, seq, is_playing = false } = req.body;

        // IP (radi i iza proxy-ja ako imaš trust proxy podešen)
        const xff = req.headers['x-forwarded-for'];
        const ipFromXff = Array.isArray(xff) ? xff[0] : (xff ? xff.split(',')[0].trim() : null);

        const ip =
        ipFromXff ||
        req.headers['x-real-ip'] ||
        req.ip ||
        req.socket?.remoteAddress ||
        null;

        // Origin / Referer (browser šalje origin za CORS/fetch, ali nekad ga nema)
        const origin = req.headers.origin || null;
        const referer = req.headers.referer || null;

        // User-Agent
        const userAgent = req.headers['user-agent'] || null;

        // Korisno za debug: host, sec-fetch-site, accept-language...
        const host = req.headers.host || null;
        const secFetchSite = req.headers['sec-fetch-site'] || null;
        const secFetchMode = req.headers['sec-fetch-mode'] || null;

        logEvent("videos.heartbeat", {
            user_id: userId,
            view_id,
            seq,
            is_playing,
            origin,
            referer,
            ip,
            //user_agent: userAgent,
            host,
            sec_fetch_site: secFetchSite,
            sec_fetch_mode: secFetchMode,
            message: "Updating View"
        });

        const updated = await videoService.heartbeatWatchDuration(view_id, {
            seq,
            isPlaying: is_playing,
            userId,
        });

        if (!updated) {
            return res.status(404).json({ success: false, message: 'view_id not found' });
        }

        return res.json({
            success: true,
            message: "OK",
        });
    } catch (err) {
        console.error('Heartbeat watch_duration failed:', err);
        return res.status(400).json({ success: false, message: err.message || 'Bad request' });
    }
}

export async function handleGenerateChapters(req, res) {
  try {
    const { videoId, languageCode } = req.body;

    if (!videoId) {
      return res.status(400).json({ success: false, message: "Missing videoId" });
    }

    const lang = String(languageCode || "en").trim().toLowerCase();
    if (!lang) {
      return res.status(400).json({ success: false, message: "Invalid languageCode" });
    }

    // 1) Uzmi mux_asset_id iz baze za dati video
    const videoRes = await readPool.query(
      `SELECT mux_asset_id
       FROM videos
       WHERE id = $1
       LIMIT 1`,
      [videoId]
    );

    if (videoRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Video not found" });
    }

    const assetId = videoRes.rows[0]?.mux_asset_id;

    if (!assetId) {
      return res.status(400).json({ success: false, message: "Video has no mux_asset_id" });
    }

    // 2) Generiši chapters preko assetId + lang
    const result = await generateChapters(assetId, lang, { provider: "openai" });

    const chapters = result?.chapters;
    if (!Array.isArray(chapters)) {
      return res.status(500).json({ success: false, message: "Invalid generateChapters result" });
    }

    // 3) (opciono) Upisi chapters nazad u isti video
    // await pool.query(
    //   `UPDATE videos
    //    SET chapters = $1::jsonb,
    //        updated_at = NOW()
    //    WHERE id = $2`,
    //   [JSON.stringify(chapters), videoId]
    // );

    return res.json({ chapters, success: true, message: "OK" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || "Internal server error" });
  }
}




/**
 * 
 * POST /videos/mock-upload
 * Kreira mock video bez stvarnog upload-a (za testiranje)
 */
// router.post('/mock-upload', requireAuth, requireAdmin, async (req, res) => {
//     try {
//         // Dynamic import za mock service
//         const mockVideoService = await import('./mockVideoService.js');
//         const result = await mockVideoService.createMockVideo(
//             req.body,
//             req.user.sub
//         );

//         res.json(result);
//     } catch (error) {
//         console.error('Mock upload error:', error);

//         if (error.issues) {
//             return res.status(400).json({
//                 message: 'Validation failed',
//                 errors: error.issues
//             });
//         }

//         res.status(500).json({
//             message: 'Failed to create mock video'
//         });
//     }
// });

/**
 * 
 * POST /videos/webhook/mux
 * Webhook endpoint za Mux events
 */

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

// Mux-Signature: "t=170...,v1=abcdef...,v1=...."
function verifyMuxSignature(rawBodyBuf, muxSignatureHeader, secret) {
  const s = secret?.trim();
  if (!s) return false;
  if (!muxSignatureHeader) return false;

  const parts = muxSignatureHeader.split(",").map(p => p.trim());

  let t = null;
  const v1s = [];

  for (const part of parts) {
    const [k, v] = part.split("=");
    if (!k || !v) continue;
    const key = k.trim();
    const val = v.trim();
    if (key === "t") t = val;
    if (key === "v1") v1s.push(val);
  }

  if (!t || v1s.length === 0) return false;

  const payload = Buffer.concat([Buffer.from(`${t}.`), rawBodyBuf]);
  const computed = crypto.createHmac("sha256", s).update(payload).digest("hex");

  // ako postoji više v1 potpisa, dovoljan je match bilo kog
  return v1s.some(sig => timingSafeEqualStr(computed, sig));
}


function getDefaultThumbnailUrl(playbackId) {
  // početak videa
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0`;
}
export async function handleMuxWebhook(req, res) {
  try {
    
    // Kada koristiš express.raw(), req.body je Buffer
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body ?? {}), "utf8");

    const sigHeader = req.get("Mux-Signature");
    const ok = verifyMuxSignature(rawBody, sigHeader, process.env.MUX_WEBHOOK_SECRET);

    if (!ok) {
      return res.status(401).json({ message: "Invalid Mux signature" });
    }

    // Tek posle verifikacije parsiraj JSON
    const event = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString("utf8"))
      : req.body;

    const type = event?.type;
    const data = event?.data;

    if (!type || !data) {
      return res.status(400).json({ message: "Invalid webhook payload" });
    }

    // tvoj video id iz baze obično dolazi kroz passthrough ili meta.external_id
    const videoId = data.passthrough || data?.meta?.external_id || null;

    // u sample payload-u asset id je data.id
    const muxAssetId = data.id || event?.object?.id || null;

    // playback id: obično data.playback_ids[0].id
    const muxPlaybackId =
      Array.isArray(data.playback_ids) && data.playback_ids.length
        ? data.playback_ids[0].id
        : null;

    switch (type) {
      case "video.asset.ready": {
        if (!videoId) {
          // nema mapiranja na tvoj DB record
          break;
        }

        const durationSeconds = Math.round(Number(data.duration || 0));
        const thumbnailUrl = muxPlaybackId ? getDefaultThumbnailUrl(muxPlaybackId) : null;

        // updejt u bazi
        await writePool.query(
          `
          UPDATE public.videos
          SET
            mux_status = 'ready',
            duration_seconds = $2,
            mux_asset_id = $3,
            mux_playback_id = COALESCE($4, mux_playback_id),
            thumbnail_url = COALESCE(thumbnail_url, $5)
          WHERE id = $1
          `,
          [videoId, durationSeconds, muxAssetId, muxPlaybackId, thumbnailUrl]
        );

        break;
      }

      case "video.asset.errored": {
        if (!videoId) break;

        await writePool.query(
          `
          UPDATE public.videos
          SET mux_status = 'errored',
              mux_asset_id = COALESCE(mux_asset_id, $2)
          WHERE id = $1
          `,
          [videoId, muxAssetId]
        );

        break;
      }
      case "video.asset.deleted": {
        const videoId = data?.passthrough || data?.meta?.external_id || null;

        if (!videoId) break;

        // ako imaš FK veze (playlist_items, watch_progress, itd.) i nemaš ON DELETE CASCADE,
        // moraćeš prvo njih da obrišeš ili da koristiš CASCADE u šemi.
        await writePool.query(`DELETE FROM public.videos WHERE id = $1`, [videoId]);

        break;
        }
      // dodaj po potrebi: video.asset.created, video.upload.cancelled, etc.
      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
}


/**
 * GET /videos/search
 * Pretraga videa (samo za ulogovane korisnike)
 */
export async function handleSearchVideos(req, res) {
    try {
        const userId = req.user?.sub || null;
        const {
            q, // search query
            category,
            tags, // comma-separated
            person,
            sort = 'relevance',
            limit = 20,
            page = 1
        } = req.query;

        const searchParams = {
            query: q,
            category,
            tags: tags ? tags.split(',').map(t => t.trim()) : null,
            person: person,
            sortBy: sort,
            limit: Math.min(parseInt(limit), 100),
            offset: (parseInt(page) - 1) * parseInt(limit)
        };

        const results = await videoService.searchVideos(searchParams, userId);

        res.json({
            videos: results.videos,
            pagination: {
                total: results.total,
                page: parseInt(page),
                limit: results.limit,
                totalPages: Math.ceil(results.total / results.limit)
            }
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ message: 'Search failed' });
    }
}

/**
 * GET /videos/trending
 * Dohvata trending videe (samo za ulogovane korisnike)
 */
export async function handleGetTrending(req, res) {
    try {
        const { limit = 20, page = 1 } = req.query;
        const userId = req.user?.sub || null;

        const query = `
            WITH recent AS (
                SELECT video_id, COUNT(DISTINCT id) AS recent_views
                FROM video_views
                WHERE created_at > NOW() - INTERVAL '30 days'
                GROUP BY video_id
            )
            SELECT
                v.id,
                v.title,
                v.thumbnail_url,
                v.duration_seconds,
                v.view_count,
                v.created_at,
                u.full_name AS uploader_name,
                ${userId ? 'wp.progress_seconds,wp.percentage_watched,' : ''}
                COALESCE(r.recent_views, 0) AS recent_views,
                COALESCE(ppl.people, '[]'::json) AS people
            FROM videos v
            LEFT JOIN users u
                ON v.uploaded_by = u.id
            ${userId ? 'LEFT JOIN watch_progress wp ON (wp.user_id = $3 AND wp.video_id = v.id)' : ''}
            LEFT JOIN recent r
                ON r.video_id = v.id
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
            ORDER BY COALESCE(r.recent_views, 0) DESC, v.view_count DESC
            LIMIT $1 OFFSET $2
        `;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        var { rows } = userId ? await readPool.query(query, [Math.min(parseInt(limit), 100), offset, userId]) : await readPool.query(query, [Math.min(parseInt(limit), 100), offset]);

        res.json({
            videos: rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Trending videos error:', error);
        res.status(500).json({ message: 'Failed to fetch trending videos' });
    }
}

export async function handleGetCategories(req, res) {
    try {
        const { limit = 20, page = 1 } = req.query;

        const query = `
            SELECT * FROM categories
            ORDER BY number ASC 
            LIMIT $1 OFFSET $2
        `;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const { rows } = await readPool.query(query, [
            Math.min(parseInt(limit), 100),
            offset
        ]);

        res.json({
            categories: rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Categories error:', error);
        res.status(500).json({ message: 'Failed to fetch categories' });
    }
}



/**
 * GET /videos/user/history
 * Dohvata istoriju gledanja za korisnika
 */
export async function handleGetUserHistory(req, res) {
    try {
        const { limit = 20, page = 1 } = req.query;

        const query = `
            SELECT 
                v.id,
                v.title,
                v.thumbnail_url,
                v.duration_seconds,
                v.view_count,
                v.created_at,
                wp.progress_seconds,
                wp.percentage_watched,
                wp.last_watched_at,
                u.full_name AS uploader_name,
                COALESCE(ppl.people, '[]'::json) AS people
            FROM watch_progress wp
            JOIN videos v ON wp.video_id = v.id
            LEFT JOIN users u ON v.uploaded_by = u.id
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
            WHERE wp.user_id = $1
                AND v.mux_status = 'ready' AND v.visibility = 'public'
            ORDER BY wp.last_watched_at DESC
            LIMIT $2 OFFSET $3
        `;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const { rows } = await readPool.query(query, [
            req.user.sub,
            Math.min(parseInt(limit), 100),
            offset
        ]);

        res.json({
            videos: rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Watch history error:', error);
        res.status(500).json({ message: 'Failed to fetch watch history' });
    }
}

export async function handleGetContinueWatching(req, res) {
    try {
        const { limit = 20, page = 1 } = req.query;

        const query = `
            SELECT 
                v.id,
                v.title,
                v.thumbnail_url,
                v.duration_seconds,
                v.view_count,
                v.created_at,
                wp.progress_seconds,
                wp.percentage_watched,
                wp.last_watched_at,
                u.full_name as uploader_name,
                COALESCE(ppl.people, '[]'::json) AS people
            FROM watch_progress wp
            JOIN videos v ON wp.video_id = v.id
            LEFT JOIN users u ON v.uploaded_by = u.id
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
            WHERE wp.user_id = $1
                AND v.mux_status = 'ready' AND v.visibility = 'public' AND (wp.percentage_watched BETWEEN 5 AND 90)
            ORDER BY wp.last_watched_at DESC
            LIMIT $2 OFFSET $3
        `;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const { rows } = await readPool.query(query, [
            req.user.sub,
            Math.min(parseInt(limit), 100),
            offset
        ]);

        res.json({
            videos: rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Watch history error:', error);
        res.status(500).json({ message: 'Failed to fetch watch history' });
    }
}
/**
 * GET /videos/user/liked
 * Dohvata lajkovane videe za korisnika
 */
export async function handleGetLikedVideos(req, res) {
    try {
        const { limit = 20, page = 1 } = req.query;

        const query = `
            SELECT 
                v.id,
                v.title,
                v.thumbnail_url,
                v.duration_seconds,
                v.view_count,
                v.created_at,
                vr.created_at as liked_at,
                u.full_name as uploader_name,
                wp.progress_seconds,
                wp.percentage_watched,
                COALESCE(ppl.people, '[]'::json) AS people
            FROM video_reactions vr
            JOIN videos v ON vr.video_id = v.id
            LEFT JOIN users u ON v.uploaded_by = u.id
            LEFT JOIN watch_progress wp
                ON (wp.user_id = $1 AND wp.video_id = v.id)
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
            WHERE vr.user_id = $1
            AND vr.reaction = 1
            AND v.mux_status = 'ready' AND v.visibility = 'public'
            ORDER BY vr.created_at DESC
            LIMIT $2 OFFSET $3
        `;


        const offset = (parseInt(page) - 1) * parseInt(limit);
        const { rows } = await readPool.query(query, [
            req.user.sub,
            Math.min(parseInt(limit), 100),
            offset
        ]);

        res.json({
            videos: rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Liked videos error:', error);
        res.status(500).json({ message: 'Failed to fetch liked videos' });
    }
}


export async function handleGetRecommended(req, res) {
    try {
        const userId = req.user.sub;
        const { limit = 20, page = 1 } = req.query;

        const videos = await videoService.getPersonalizedRecommendations(userId, limit, page);

        if (!videos) {
            return res.status(404).json({ message: 'Video not found' });
        }

        res.json({
            videos: videos,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get video error:', error);
        res.status(500).json({ message: 'Failed to fetch video' });
    }
}

/**
 * POST /videos/:id/progress
 * Ažurira progres gledanja
 */
export async function handleUpdateProgress(req, res) {
    try {
        const { progressSeconds } = req.body;
        if (typeof progressSeconds !== 'number' || progressSeconds < 0) {
            return res.status(400).json({
                message: 'Invalid progress value'
            });
        }

        await videoService.updateWatchProgress(
            req.params.id,
            req.user.sub,
            progressSeconds
        );

        res.json({
            success: true,
            message: 'Progress updated'
        });
    } catch (error) {
        console.error('Progress update error:', error);
        res.status(500).json({ message: 'Failed to update progress' });
    }
}

/**
 * POST /videos/:id/like
 * Toggle like za video
 */
export async function handleLikeVideo(req, res) {
    try {
        const result = await videoService.setVideoReaction(req.params.id, req.user.sub, "like");
        res.json({ success: true, status: result.status });
    } catch (e) {
        res.status(500).json({ message: "Failed to set like" });
    }
}

export async function handleDislikeVideo(req, res) {
    try {
        const result = await videoService.setVideoReaction(req.params.id, req.user.sub, "dislike");
        res.json({ success: true, status: result.status });
    } catch (e) {
        res.status(500).json({ message: "Failed to set dislike" });
    }
}


export async function handleGetSimilarVideos(req, res) {
    try {
        const userId = req.user?.sub || null;
        const videoId = req.params.id;
        const { limit = 20, page = 1 } = req.query;

        const videos = await videoService.getRecommendedVideos(videoId, userId, limit, page);

        if (!videos) {
            return res.status(404).json({ message: 'Video not found' });
        }

        res.json({
            videos: videos,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get video error:', error);
        res.status(500).json({ message: 'Failed to fetch video' });
    }
}


/**
 * GET /videos/:id
 * Dohvata pojedinačni video (samo za ulogovane korisnike)
 * MORA biti na kraju jer hvata sve!
 */
export async function handleGetVideoById(req, res) {
    try {
        const userId = req.user?.sub || null;
        let video = await videoService.getVideoById(req.params.id, userId);


        if (!video) {
            logEvent("videos.get_failed", { user_id: userId,message: "No video"});
            return res.status(404).json({ message: 'Video not found' });
        }
        let view = null;
        try {
            view = await videoService.incrementViewCount(req.params.id, {
                userId,
                ip: getClientIp(req),
                userAgent: req.get('user-agent') || ''
            });
        } catch (e) {
            console.warn('View tracking failed (ignored):', e);
        }
        video.view = view;
        logEvent("videos.get_success", { user_id: userId,video:{id: video.id, title:video.title},view:view,message: "Successfull"});
        return res.json(video);
    } catch (error) {
        console.error('Get video error:', error);
        res.status(500).json({ message: 'Failed to fetch video' });
    }
}

export async function handleGetComments(req, res) {
    try {
        const user_id = req.user?.sub || null;
        const video_id = req.params.id;

        if(!video_id){
            return res.status(400).json({message: "Missing video id"});
        }

        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
        const offset = (page - 1) * limit;

        const sort = String(req.query.sort || "new").toLocaleLowerCase();
        const orderBy = sort === "top" ? "c.like_count DESC, c.created_at DESC":"c.created_at DESC";

        const countRes = await readPool.query(
            `
            SELECT COUNT(*)::int AS total
            FROM public.video_comments c
            WHERE c.video_id = $1 AND c.parent_id IS NULL AND c.is_deleted=false
            `,
            [video_id]
        );

        const total = countRes.rows[0]?.total || 0;

        const params = [video_id,user_id,limit,offset];

        const sql = 
        `
        SELECT
            c.id,
            c.video_id,
            c.user_id,
            c.parent_id,
            CASE WHEN c.is_deleted THEN NULL ELSE c.content END AS content,
            c.like_count,
            c.dislike_count,
            c.reply_count,
            c.created_at,
            c.updated_at,
            u.full_name AS author_full_name,
            u.image_url AS author_image_url,
            cr.reaction AS my_reaction
        FROM public.video_comments c
        JOIN public.users u ON u.id = c.user_id
        LEFT JOIN public.comment_reactions cr ON cr.comment_id = c.id AND cr.user_id = $2
        WHERE c.video_id = $1 AND c.parent_id IS NULL AND c.is_deleted = false
        ORDER BY ${orderBy}
        LIMIT $3 OFFSET $4
        `

        const commentsRes = await readPool.query(sql,params);

        return res.json({
            comments: commentsRes.rows,
            page,
            limit,
            total,
            total_pages: Math.ceil(total / limit),
        })

    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Internal server error" });
    }
}

function getClientIp(req) {
    // express će uz trust proxy koristiti X-Forwarded-For
    let ip = req.ip || "";

    // skini IPv6-mapped IPv4 prefix ::ffff:
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    return ip; // može biti i "::1" u lokalnom testu
}



