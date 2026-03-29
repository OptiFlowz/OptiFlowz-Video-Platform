// videoRoutes.js
import {  readPool,writePool } from '../../database/index.js';

import multer from "multer";
import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { Agent } from "undici";


const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ENDPOINT =
  process.env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT, // https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com
  forcePathStyle: true,  // ✅ ključno
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET;

function muxBasicAuthHeader() {
  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;
  const b64 = Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64");
  return `Basic ${b64}`;
}


// GET /subtitle/:videoId?lang=en
// GET /subtitle/:videoId?lang=en
export async function handleGetSubtitle(req, res) {
  try {
    const { videoId } = req.params;
    const lang = String(req.query.lang || "").trim().toLowerCase();

    if (!lang) {
      return res.status(400).json({ message: "Missing query param: lang (e.g. ?lang=en)" });
    }

    const { rows } = await readPool.query(
      `
      SELECT mux_status, mux_asset_id, mux_playback_id
      FROM public.videos
      WHERE id = $1
      LIMIT 1
      `,
      [videoId]
    );

    const video = rows[0];
    if (!video) return res.status(404).json({ message: "Video not found" });

    const muxStatus = String(video.mux_status || "").toLowerCase();

    // ✅ prvo status iz baze
    if (muxStatus !== "ready") {
      // ako želiš striktno:
      // return res.status(409).json({ code: "ASSET_NOT_READY", message: "Video is not ready yet", mux_status: muxStatus });

      return res.status(202).json({
        code: "ASSET_PROCESSING",
        message: "Video is still processing on Mux",
        mux_status: muxStatus || null,
      });
    }

    const assetId = video.mux_asset_id;
    const playbackId = video.mux_playback_id;

    if (!assetId || !playbackId) {
      return res.status(400).json({
        message: "Video is missing mux_asset_id or mux_playback_id in DB",
      });
    }

    // --- Mux retrieve asset ---
    const muxResp = await fetch(`https://api.mux.com/video/v1/assets/${assetId}`, {
      method: "GET",
      headers: {
        Authorization: muxBasicAuthHeader(),
        "Content-Type": "application/json",
      },
    });

    if (!muxResp.ok) {
      const txt = await muxResp.text().catch(() => "");
      return res.status(502).json({
        message: "Mux API error (retrieve asset)",
        status: muxResp.status,
        details: txt?.slice(0, 500),
      });
    }

    const muxJson = await muxResp.json();
    const tracks = muxJson?.data?.tracks || [];

    const wantedTrack =
      tracks.find(
        (t) =>
          t.type === "text" &&
          (t.text_type === "subtitles" || t.text_type === "captions") &&
          String(t.language_code || "").toLowerCase() === lang
      ) || null;

    // 1) track ne postoji
    if (!wantedTrack?.id) {
      return res.status(404).json({
        code: "NO_CAPTIONS",
        message: "Subtitle track for this language does not exist",
        lang,
      });
    }

    const trackId = wantedTrack.id;
    const trackStatus = String(wantedTrack.status || "").toLowerCase();

    // 2) track postoji ali nije ready
    if (trackStatus && trackStatus !== "ready") {
      if (trackStatus === "preparing") {
        return res.status(202).json({
          code: "CAPTIONS_PROCESSING",
          message: "Captions are being generated",
          lang,
          track_id: trackId,
          track_status: trackStatus,
        });
      }
      if (trackStatus === "errored") {
        return res.status(502).json({
          code: "CAPTIONS_ERRORED",
          message: "Caption generation failed",
          lang,
          track_id: trackId,
          track_status: trackStatus,
        });
      }
      return res.status(202).json({
        code: "CAPTIONS_NOT_READY",
        message: "Captions exist but are not ready yet",
        lang,
        track_id: trackId,
        track_status: trackStatus,
      });
    }

    // 3) ready => fetch VTT
    const vttUrl = `https://stream.mux.com/${playbackId}/text/${trackId}.vtt`;
    const vttResp = await fetch(vttUrl);

    // ako stream endpoint kasni: tretiraj kao processing
    if (!vttResp.ok) {
      const txt = await vttResp.text().catch(() => "");
      if (vttResp.status === 404 || vttResp.status === 409) {
        return res.status(202).json({
          code: "CAPTIONS_PROCESSING",
          message: "Captions are being generated (VTT not available yet)",
          lang,
          track_id: trackId,
          vtt_status: vttResp.status,
        });
      }
      return res.status(502).json({
        message: "Failed to fetch VTT from Mux stream endpoint",
        status: vttResp.status,
        details: txt?.slice(0, 500),
        vtt_url: vttUrl,
      });
    }

    const vttText = await vttResp.text();

    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("X-Mux-Track-Id", trackId);
    res.setHeader("X-Mux-Lang", lang);
    res.setHeader("X-Mux-VTT-Url", vttUrl);
    return res.send(vttText);
  } catch (err) {
    console.error("subtitle route error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// ===== Multer =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB, promeni po potrebi
});

export const subtitleUploadMiddleware = upload.single("file");

// ===== Mux helpers =====
function muxAuthHeader() {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  const b64 = Buffer.from(`${id}:${secret}`).toString("base64");
  return `Basic ${b64}`;
}

async function muxGetAsset(assetId) {
  const resp = await fetch(`https://api.mux.com/video/v1/assets/${assetId}`, {
    headers: {
      Authorization: muxAuthHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`MUX_GET_ASSET_FAILED:${resp.status}:${txt.slice(0, 300)}`);
  }

  return resp.json();
}

async function muxDeleteTrack(assetId, trackId) {
  const resp = await fetch(
    `https://api.mux.com/video/v1/assets/${assetId}/tracks/${trackId}`,
    {
      method: "DELETE",
      headers: { Authorization: muxAuthHeader() },
    }
  );

  // Mux uglavnom vraća 204, ali i 200 može – tretiraj ok ako je ok
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`MUX_DELETE_TRACK_FAILED:${resp.status}:${txt.slice(0, 300)}`);
  }
}

async function muxCreateTextTrack(assetId, url, { language_code, name, text_type = "subtitles" } = {}) {
  const body = {
    url,
    type: "text",
    text_type,               // "subtitles" ili "captions"
    closed_captions: false,
    language_code: language_code || "en",
    name: name || `Subtitles (${language_code || "en"})`,
  };

  const resp = await fetch(`https://api.mux.com/video/v1/assets/${assetId}/tracks`, {
    method: "POST",
    headers: {
      Authorization: muxAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`MUX_CREATE_TRACK_FAILED:${resp.status}:${txt.slice(0, 300)}`);
  }

  return resp.json();
}


function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTrackReady(assetId, trackId, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const assetJson = await muxGetAsset(assetId);
    const track = (assetJson?.data?.tracks || []).find((t) => t.id === trackId);

    const status = track?.status; // "preparing" | "ready" | "errored" | "deleted" :contentReference[oaicite:1]{index=1}
    if (status === "ready") return { ok: true, status };
    if (status === "errored") return { ok: false, status, errors: assetJson?.data?.errors };

    await sleep(2000); // 2s
  }
  return { ok: false, status: "timeout" };
}



// ===== ROUTE =====
// POST /admin/videos/:videoId/subtitles/replace
// multipart/form-data: file=<your .vtt>
// POST /subtitle/replace/:videoId?lang=en&name=English
export async function handleReplaceSubtitle(req, res) {
  const { videoId } = req.params;
  const lang = String(req.query.lang || "").trim().toLowerCase();
  const trackNameRaw = String(req.query.name || "").trim();
  const trackName = trackNameRaw.length ? trackNameRaw.slice(0, 60) : `Subtitles (${lang.toUpperCase()})`;

  if (!lang) {
    return res.status(400).json({ message: "Missing query param: lang (e.g. ?lang=en)" });
  }

  if (!trackName) {
    return res.status(400).json({ message: "Missing query param: lang (e.g. ?lang=en)" });
  }

  if (!req.file) {
    return res.status(400).json({ message: "File is required (field: file)" });
  }

  const filename = (req.file.originalname || "").toLowerCase();
  const isVttName = filename.endsWith(".vtt");
  const isVttMime =
    req.file.mimetype === "text/vtt" ||
    req.file.mimetype === "text/plain" ||
    req.file.mimetype === "application/octet-stream";

  if (!isVttName || !isVttMime) {
    return res.status(400).json({ message: "Only .vtt subtitle files are allowed" });
  }

  let tempKey = null;

  try {
    const { rows } = await readPool.query(
      `SELECT mux_asset_id FROM public.videos WHERE id = $1 LIMIT 1`,
      [videoId]
    );
    const assetId = rows[0]?.mux_asset_id;

    if (!assetId) {
      return res.status(404).json({ message: "Video not found or missing mux_asset_id" });
    }

    // 2) Upload na R2 temp
    tempKey = `temp/subtitles/${videoId}/${lang}/${randomUUID()}.vtt`;

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: tempKey,
        Body: req.file.buffer,
        ContentType: "text/vtt",
        CacheControl: "no-store",
      })
    );

    // 3) Presigned URL
    const signedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: tempKey }),
      { expiresIn: 60 * 30 }
    );

    // 4) Retrieve asset -> nađi postojeći track ZA TAJ JEZIK
    const assetJson = await muxGetAsset(assetId);
    const tracks = assetJson?.data?.tracks || [];

    const existingLangTrack =
      tracks.find(
        (t) =>
          t.type === "text" &&
          (t.text_type === "subtitles" || t.text_type === "captions") &&
          String(t.language_code || "").toLowerCase() === lang
      ) || null;

    const oldTrackId = existingLangTrack?.id || null;

    // 5) Obriši samo taj lang track ako postoji
    if (oldTrackId) {
      await muxDeleteTrack(assetId, oldTrackId);
    }

    // 6) Kreiraj novi track za taj jezik
    const created = await muxCreateTextTrack(assetId, signedUrl, {
      language_code: lang,
      name: trackName,
      text_type: "subtitles",
    });

    const newTrackId = created?.data?.id || null;

    const waitRes = await waitForTrackReady(assetId, newTrackId, 30_000);

    // 7) Briši temp fajl
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: tempKey })).catch(() => { });

    if (!waitRes.ok) {
      return res.status(502).json({
        message: "Mux track was not ready",
        lang,
        track_status: waitRes.status,
        mux_errors: waitRes.errors || null,
      });
    }

    return res.json({
      message: oldTrackId ? "Subtitle track replaced" : "Subtitle track created",
      lang,
      name: trackName,
      video_id: videoId,
      mux_asset_id: assetId,
      old_track_id: oldTrackId,
      new_track_id: newTrackId,
    });
  } catch (err) {
    console.error("replace subtitles error:", err);

    if (tempKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: tempKey }));
      } catch (e) { }
    }

    const msg = String(err?.message || "");
    if (msg.startsWith("MUX_")) {
      return res.status(502).json({ message: "Mux error", details: msg });
    }

    return res.status(500).json({ message: "Server error" });
  }
}


// POST ZA CREATE/REPLACE rucno se salje vtt u body
export async function handleReplaceSubtitleV2(req, res) {
  const { videoId } = req.params;
  const lang = String(req.query.lang || "").trim().toLowerCase();
  const trackNameRaw = String(req.query.name || "").trim();
  const trackName = trackNameRaw.length ? trackNameRaw.slice(0, 60) : `Subtitles (${lang.toUpperCase()})`;

  if (!lang) {
    return res.status(400).json({ message: "Missing query param: lang (e.g. ?lang=en)" });
  }

  // očekujemo VTT tekst u body-u
  const vttTextRaw = req.body?.vtt; // ili req.body?.content / kako god želiš da nazoveš
  if (typeof vttTextRaw !== "string" || !vttTextRaw.trim()) {
    return res.status(400).json({ message: "Body field 'vtt' is required (string)" });
  }

  // Minimalna validacija da li liči na VTT
  // (Mux je generalno OK sa "WEBVTT" headerom; bolje je da ga ima)
  let vttText = vttTextRaw.replace(/\r\n/g, "\n").trimStart();

  if (!vttText.startsWith("WEBVTT")) {
    // opcija A: odbij
    // return res.status(400).json({ message: "Invalid VTT: missing WEBVTT header" });

    // opcija B: auto-fix (praktičnije)
    vttText = `WEBVTT\n\n${vttText.trim()}\n`;
  } else {
    // obezbedi newline na kraju (nekim parserima znači)
    if (!vttText.endsWith("\n")) vttText += "\n";
  }

  const vttBuffer = Buffer.from(vttText, "utf8");

  let tempKey = null;

  try {
    const { rows } = await readPool.query(
      `SELECT mux_asset_id FROM public.videos WHERE id = $1 LIMIT 1`,
      [videoId]
    );
    const assetId = rows[0]?.mux_asset_id;

    if (!assetId) {
      return res.status(404).json({ message: "Video not found or missing mux_asset_id" });
    }

    // 2) Upload na R2 temp
    tempKey = `temp/subtitles/${videoId}/${lang}/${randomUUID()}.vtt`;

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: tempKey,
        Body: vttBuffer,
        ContentType: "text/vtt; charset=utf-8",
        CacheControl: "no-store",
      })
    );

    // 3) Presigned URL
    const signedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: tempKey }),
      { expiresIn: 60 * 30 }
    );

    // 4) Retrieve asset -> nađi postojeći track ZA TAJ JEZIK
    const assetJson = await muxGetAsset(assetId);
    const tracks = assetJson?.data?.tracks || [];

    const existingLangTrack =
      tracks.find(
        (t) =>
          t.type === "text" &&
          (t.text_type === "subtitles" || t.text_type === "captions") &&
          String(t.language_code || "").toLowerCase() === lang
      ) || null;

    const oldTrackId = existingLangTrack?.id || null;

    // 5) Obriši samo taj lang track ako postoji
    if (oldTrackId) {
      await muxDeleteTrack(assetId, oldTrackId);
    }

    // 6) Kreiraj novi track za taj jezik
    const created = await muxCreateTextTrack(assetId, signedUrl, {
      language_code: lang,
      name: trackName,
      text_type: "subtitles",
    });

    const newTrackId = created?.data?.id || null;

    const waitRes = await waitForTrackReady(assetId, newTrackId, 30_000);

    // 7) Briši temp fajl
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: tempKey })).catch(() => { });

    if (!waitRes.ok) {
      return res.status(502).json({
        message: "Mux track was not ready",
        lang,
        track_status: waitRes.status,
        mux_errors: waitRes.errors || null,
      });
    }

    return res.json({
      message: oldTrackId ? "Subtitle track replaced" : "Subtitle track created",
      lang,
      name: trackName,
      video_id: videoId,
      mux_asset_id: assetId,
      old_track_id: oldTrackId,
      new_track_id: newTrackId,
    });
  } catch (err) {
    console.error("replace subtitles error:", err);

    if (tempKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: tempKey }));
      } catch (e) { }
    }

    const msg = String(err?.message || "");
    if (msg.startsWith("MUX_")) {
      return res.status(502).json({ message: "Mux error", details: msg });
    }

    return res.status(500).json({ message: "Server error" });
  }
}




// DELETE /subtitle/:videoId?lang=en
export async function handleDeleteSubtitle(req, res) {
  try {
    const { videoId } = req.params;
    const lang = String(req.query.lang || "").trim().toLowerCase();

    if (!lang) {
      return res.status(400).json({ message: "Missing query param: lang (e.g. ?lang=en)" });
    }

    // 1) Uzmi mux_asset_id iz baze
    const { rows } = await readPool.query(
      `SELECT mux_asset_id FROM public.videos WHERE id = $1 LIMIT 1`,
      [videoId]
    );

    const assetId = rows[0]?.mux_asset_id;
    if (!assetId) {
      return res.status(404).json({ message: "Video not found or missing mux_asset_id" });
    }

    // 2) Mux: retrieve asset da dobiješ tracks
    const assetJson = await muxGetAsset(assetId);
    const tracks = assetJson?.data?.tracks || [];

    // 3) Nađi subtitle/captions text track za dati jezik
    const existingLangTrack =
      tracks.find(
        (t) =>
          t.type === "text" &&
          (t.text_type === "subtitles" || t.text_type === "captions") &&
          String(t.language_code || "").toLowerCase() === lang
      ) || null;

    if (!existingLangTrack?.id) {
      return res.status(404).json({
        message: "Subtitle track for this language does not exist",
        lang,
        video_id: videoId,
        mux_asset_id: assetId,
      });
    }

    const trackId = existingLangTrack.id;

    // 4) Obriši track
    await muxDeleteTrack(assetId, trackId);

    return res.json({
      message: "Subtitle track deleted",
      lang,
      video_id: videoId,
      mux_asset_id: assetId,
      deleted_track_id: trackId,
    });
  } catch (err) {
    console.error("delete subtitle error:", err);

    const msg = String(err?.message || "");
    if (msg.startsWith("MUX_")) {
      return res.status(502).json({ message: "Mux error", details: msg });
    }

    return res.status(500).json({ message: "Server error" });
  }
}



// auto generate subtitles

function sanitizeLang(lang) {
  return String(lang || "").trim().toLowerCase();
}

function sanitizeName(name, fallback) {
  const n = String(name || "").trim();
  return (n.length ? n : fallback).slice(0, 80);
}

function pickTextTrackByLang(tracks, lang) {
  const l = sanitizeLang(lang);

  return (
    tracks.find(
      (t) =>
        t.type === "text" &&
        (t.text_type === "subtitles" || t.text_type === "captions") &&
        String(t.language_code || "").toLowerCase() === l
    ) || null
  );
}

async function fetchVttFromMux(playbackId, trackId) {
  const vttUrl = `https://stream.mux.com/${playbackId}/text/${trackId}.vtt`;
  const resp = await fetch(vttUrl);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`MUX_FETCH_VTT_FAILED:${resp.status}:${txt.slice(0, 300)}`);
  }
  const vttText = await resp.text();
  return { vttText, vttUrl };
}

function ensureWebVttHeader(vttText) {
  const s = String(vttText || "").replace(/^\uFEFF/, "").trimStart(); // remove BOM if any
  if (s.toUpperCase().startsWith("WEBVTT")) return s;
  return `WEBVTT\n\n${s}`;
}

const n8nAgent = new Agent({
  connect: { timeout: 30_000 },          // connect timeout
  headersTimeout: 35 * 60 * 1000,        // čekanje na response HEADERS
  bodyTimeout: 35 * 60 * 1000,           // čekanje na BODY posle headers
});

async function callN8nTranslateVtt({ sourceVtt, targetLang, name, videoId }) {
  const webhookUrl = process.env.N8N_TRANSLATE_SUBS_WEBHOOK;
  if (!webhookUrl) throw new Error("N8N_WEBHOOK_NOT_CONFIGURED");

  const token = process.env.N8N_TRANSLATE_SUBS_BEARER_TOKEN;
  if (!token) throw new Error("N8N_BEARER_NOT_CONFIGURED");
  // timeout safety
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20 * 60 * 1000);
  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      dispatcher: n8nAgent, // 👈 bitno
      headers: {
        "Content-Type": "application/json",
        Authorization: `${token}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        videoId,
        sourceLang: "en",
        targetLang,
        name,
        vtt: sourceVtt,
      }),
    });

    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      throw new Error(`N8N_FAILED:${resp.status}:${text.slice(0, 300)}`);
    }

    // Podržavamo oba: JSON { vtt: "..." } ili plain text koji je VTT.
    let outVtt = null;
    try {
      const json = JSON.parse(text);
      outVtt = json?.vtt || json?.data?.vtt || json?.result?.vtt || null;
    } catch {
      outVtt = text;
    }

    if (!outVtt || !String(outVtt).trim()) {
      throw new Error("N8N_RETURNED_EMPTY_VTT");
    }

    return String(outVtt);
  } finally {
    clearTimeout(t);
  }
}

// POST /subtitle/autogenerate/:videoId?lang=sr&name=Srpski AUTOMATSKI VRACA I POSTAVLJA
export async function handleAutogenerateAndReplaceSubtitle(req, res) {
  const { videoId } = req.params;
  const lang = sanitizeLang(req.query.lang);
  const name = sanitizeName(req.query.name, `Subtitles (${lang.toUpperCase()})`);

  if (!lang) {
    return res.status(400).json({ message: "Missing query param: lang (e.g. ?lang=sr)" });
  }

  let tempKey = null;

  try {
    // 1) DB: uzmi mux ids
    const { rows } = await readPool.query(
      `SELECT mux_asset_id, mux_playback_id FROM public.videos WHERE id = $1 LIMIT 1`,
      [videoId]
    );
    const assetId = rows[0]?.mux_asset_id;
    const playbackId = rows[0]?.mux_playback_id;

    if (!assetId || !playbackId) {
      return res.status(404).json({ message: "Video not found or missing mux ids" });
    }

    // 2) Mux: retrieve asset tracks
    const assetJson = await muxGetAsset(assetId);
    const tracks = assetJson?.data?.tracks || [];

    // 3) Nađi EN track (ako ne postoji -> greška)
    const enTrack = pickTextTrackByLang(tracks, "en");
    if (!enTrack?.id) {
      return res.status(404).json({ message: "English subtitle track (en) does not exist on this asset" });
    }

    // 4) Skini EN VTT
    const { vttText: enVtt, vttUrl: enVttUrl } = await fetchVttFromMux(playbackId, enTrack.id);

    // 5) Pošalji na n8n (prevod)
    const translatedRaw = await callN8nTranslateVtt({
      sourceVtt: enVtt,
      targetLang: lang,
      name,
      videoId,
    });

    if (!translatedRaw)
      return res.status(404).json({ message: "N8n Error" });
    const translatedVtt = ensureWebVttHeader(translatedRaw);

    // 6) Upload prevedeni VTT na R2 temp
    tempKey = `temp/subtitles/${videoId}/${lang}/${randomUUID()}.vtt`;

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: tempKey,
        Body: Buffer.from(translatedVtt, "utf-8"),
        ContentType: "text/vtt; charset=utf-8",
        CacheControl: "no-store",
      })
    );

    // 7) Presigned URL (Mux povlači)
    const signedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: tempKey }),
      { expiresIn: 60 * 30 }
    );

    // 8) Osveži tracks i nađi postojeći track za target lang
    const assetJson2 = await muxGetAsset(assetId);
    const tracks2 = assetJson2?.data?.tracks || [];

    const existingTargetTrack = pickTextTrackByLang(tracks2, lang);
    const oldTrackId = existingTargetTrack?.id || null;

    // 9) Ako postoji, obriši ga (replace). Ako ne postoji, samo create.
    if (oldTrackId) {
      await muxDeleteTrack(assetId, oldTrackId);
    }

    // 10) Kreiraj novi track za target lang + name
    const created = await muxCreateTextTrack(assetId, signedUrl, {
      language_code: lang,
      name,
      text_type: "subtitles",
    });

    const newTrackId = created?.data?.id || null;

    // 11) Sačekaj ready
    const waitRes = await waitForTrackReady(assetId, newTrackId, 60_000);

    // 12) Očisti temp fajl
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: tempKey })).catch(() => { });

    if (!waitRes.ok) {
      return res.status(502).json({
        message: "Mux track was not ready",
        lang,
        name,
        track_status: waitRes.status,
        mux_errors: waitRes.errors || null,
      });
    }

    return res.json({
      message: oldTrackId ? "Subtitle auto-generated & replaced" : "Subtitle auto-generated & created",
      video_id: videoId,
      mux_asset_id: assetId,
      source_lang: "en",
      target_lang: lang,
      name,
      source_track_id: enTrack.id,
      old_track_id: oldTrackId,
      new_track_id: newTrackId,
      source_vtt_url: enVttUrl,
    });
  } catch (err) {
    console.error("autogenerate subtitles error:", err);

    if (tempKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: tempKey }));
      } catch (e) { }
    }

    const msg = String(err?.message || "");
    if (msg.startsWith("MUX_")) {
      return res.status(502).json({ message: "Mux error", details: msg });
    }
    if (msg.startsWith("N8N_") || msg === "N8N_WEBHOOK_NOT_CONFIGURED" || msg === "N8N_RETURNED_EMPTY_VTT") {
      return res.status(502).json({ message: "n8n error", details: msg });
    }

    return res.status(500).json({ message: "Server error" });
  }
}


// GET AUTOGENERATE SAMO VRACA TEXT
export async function handleAutogenerateSubtitlePreview(req, res) {
  const { videoId } = req.params;
  const lang = sanitizeLang(req.query.lang);
  const name = sanitizeName(req.query.name, `Subtitles (${lang?.toUpperCase?.() || ""})`);

  if (!lang) {
    return res.status(400).json({ message: "Missing query param: lang (e.g. ?lang=sr)" });
  }

  try {
    // 1) DB: uzmi mux ids
    const { rows } = await readPool.query(
      `SELECT mux_asset_id, mux_playback_id FROM public.videos WHERE id = $1 LIMIT 1`,
      [videoId]
    );
    const assetId = rows[0]?.mux_asset_id;
    const playbackId = rows[0]?.mux_playback_id;

    if (!assetId || !playbackId) {
      return res.status(404).json({ message: "Video not found or missing mux ids" });
    }

    // 2) Mux: retrieve asset tracks
    const assetJson = await muxGetAsset(assetId);
    const tracks = assetJson?.data?.tracks || [];

    // 3) Nađi EN track (ako ne postoji -> greška)
    const enTrack = pickTextTrackByLang(tracks, "en");
    if (!enTrack?.id) {
      return res
        .status(404)
        .json({ message: "English subtitle track (en) does not exist on this asset" });
    }

    // 4) Skini EN VTT
    const { vttText: enVtt } = await fetchVttFromMux(playbackId, enTrack.id);

    // 5) Pošalji na n8n (prevod)
    const translatedRaw = await callN8nTranslateVtt({
      sourceVtt: enVtt,
      targetLang: lang,
      name,
      videoId,
    });

    if (!translatedRaw) {
      return res.status(502).json({ message: "n8n returned empty response" });
    }

    const translatedVtt = ensureWebVttHeader(translatedRaw);

    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("X-Subtitles-Source-Lang", "en");
    res.setHeader("X-Subtitles-Target-Lang", lang);
    res.setHeader("X-Subtitles-Name", name);

    // Pošalji kao plain text u body-ju
    return res.status(200).send(translatedVtt);
  } catch (err) {
    console.error("autogenerate subtitles error:", err);

    const msg = String(err?.message || "");
    if (msg.startsWith("MUX_")) {
      return res.status(502).json({ message: "Mux error", details: msg });
    }
    if (msg.startsWith("N8N_") || msg === "N8N_WEBHOOK_NOT_CONFIGURED" || msg === "N8N_RETURNED_EMPTY_VTT") {
      return res.status(502).json({ message: "n8n error", details: msg });
    }

    return res.status(500).json({ message: "Server error" });
  }
}


export async function handleAutogenerateDetails(req, res) {
  const { videoId } = req.params;
  const type = sanitizeLang(req.query.type);

  if (!type) {
    return res.status(400).json({ message: "Missing query param: type (e.g. ?type=title/description/tags)" });
  }

  try {
    // 1) DB: uzmi mux ids
    const { rows } = await readPool.query(
      `SELECT mux_asset_id, mux_playback_id FROM public.videos WHERE id = $1 LIMIT 1`,
      [videoId]
    );
    const assetId = rows[0]?.mux_asset_id;
    const playbackId = rows[0]?.mux_playback_id;

    if (!assetId || !playbackId) {
      return res.status(404).json({ message: "Video not found or missing mux ids" });
    }

    // 2) Mux: retrieve asset tracks
    const assetJson = await muxGetAsset(assetId);
    const tracks = assetJson?.data?.tracks || [];

    // 3) Nađi EN track
    const enTrack = pickTextTrackByLang(tracks, "en");
    if (!enTrack?.id) {
      return res.status(404).json({
        message: "English subtitle track (en) does not exist on this asset",
      });
    }

    // 4) Skini EN VTT
    const { vttText: enVtt } = await fetchVttFromMux(playbackId, enTrack.id);
    if (!enVtt || !enVtt.trim()) {
      return res.status(502).json({ message: "Mux returned empty VTT" });
    }

    // 5) Pošalji na n8n i prosledi samo "result"
    const webhookUrl = process.env.N8N_GENERATE_DETAILS_WEBHOOK; // promeni ako ti je drugačije
    const token = process.env.N8N_TRANSLATE_SUBS_BEARER_TOKEN;

    if (!webhookUrl) return res.status(500).json({ message: "N8N webhook not configured" });
    if (!token) return res.status(500).json({ message: "N8N bearer token missing" });

    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `${token}`,
      },
      body: JSON.stringify({ type, vttText: enVtt }),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return res.status(502).json({
        message: "n8n error",
        details: `N8N_BAD_STATUS:${r.status}${txt ? `:${txt.slice(0, 500)}` : ""}`,
      });
    }

    const data = await r.json().catch(() => null);
    if (!data || typeof data !== "object" || !("result" in data)) {
      return res.status(502).json({ message: "n8n returned invalid response", details: data });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("autogenerate subtitles error:", err);

    const msg = String(err?.message || "");
    if (msg.startsWith("MUX_")) {
      return res.status(502).json({ message: "Mux error", details: msg });
    }

    return res.status(500).json({ message: "Server error" });
  }
}




function isDefined(v) {
  return v !== undefined;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return null;
  const cleaned = [...new Set(tags.map((x) => String(x).trim()).filter(Boolean))];
  return cleaned;
}

function normalizePeopleArray(arr) {
  if (!Array.isArray(arr)) return null;
  const ids = arr
    .map((x) => (x && typeof x === "object" ? x.person_id : x))
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

function normalizeChapters(chapters) {
  if (!Array.isArray(chapters)) return null;

  const cleaned = chapters
    .map((c) => ({
      title: String(c?.title ?? "").trim(),
      startTime: Number(c?.startTime),
    }))
    .filter((c) => c.title && Number.isFinite(c.startTime) && c.startTime >= 0)
    .sort((a, b) => a.startTime - b.startTime);

  return cleaned;
}

export async function handlePatchVideoDetails(req, res) {
  const { videoId } = req.params;

  const {
    title,
    description,
    thumbnail_url,
    tags,
    chapters,
    visibility, // "public" | "private"
    chairs,
    speakers,
  } = req.body || {};

  // visibility validacija (null ne prihvatamo; ako hoćeš i null->NULL reci)
  let visibilityNorm = undefined;
  if (isDefined(visibility)) {
    visibilityNorm = visibility === null ? "private" : String(visibility).toLowerCase();
    if (visibilityNorm !== "public" && visibilityNorm !== "private") {
      return res.status(400).json({ message: "visibility must be 'public' or 'private' (or null -> private)" });
    }
  }

  // --- normalizacije sa podrškom za null (null => brisanje) ---
  const normTags = isDefined(tags) ? (tags === null ? null : normalizeTags(tags)) : undefined;
  if (isDefined(tags) && tags !== null && normTags === null) {
    return res.status(400).json({ message: "tags must be an array of strings or null" });
  }

  const normChapters = isDefined(chapters)
    ? (chapters === null ? null : normalizeChapters(chapters))
    : undefined;
  if (isDefined(chapters) && chapters !== null && normChapters === null) {
    return res.status(400).json({ message: "chapters must be an array of {title, startTime} or null" });
  }

  const chairIds = isDefined(chairs) ? (chairs === null ? [] : normalizePeopleArray(chairs)) : undefined;
  if (isDefined(chairs) && chairs !== null && chairIds === null) {
    return res.status(400).json({ message: "chairs must be an array of {person_id} or ids, or null" });
  }

  const speakerIds = isDefined(speakers)
    ? (speakers === null ? [] : normalizePeopleArray(speakers))
    : undefined;
  if (isDefined(speakers) && speakers !== null && speakerIds === null) {
    return res.status(400).json({ message: "speakers must be an array of {person_id} or ids, or null" });
  }

  const anyVideoField =
    isDefined(title) ||
    isDefined(description) ||
    isDefined(thumbnail_url) ||
    isDefined(tags) ||
    isDefined(chapters) ||
    isDefined(visibility);

  const anyPeopleField = isDefined(chairs) || isDefined(speakers);

  if (!anyVideoField && !anyPeopleField) {
    return res.status(400).json({ message: "No fields provided" });
  }

  const client = await writePool.connect();
  try {
    await client.query("BEGIN");

    let updatedVideo = null;

    if (anyVideoField) {
      const set = [];
      const params = [videoId];
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

      // thumbnail_url: null => NULL, string => value
      if (isDefined(thumbnail_url)) {
        set.push(`thumbnail_url = $${i++}`);
        params.push(thumbnail_url === null ? null : String(thumbnail_url).trim());
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

      // chapters: null => NULL, array => jsonb
      if (isDefined(chapters)) {
        if (chapters === null) {
          set.push(`chapters = NULL`);
        } else {
          set.push(`chapters = $${i++}::jsonb`);
          params.push(JSON.stringify(normChapters));
        }
      }

      // visibility: public/private (null nije dozvoljen)
      if (isDefined(visibility)) {
        const v = visibilityNorm; // "public" ili "private" (null -> private)

        set.push(`visibility = $${i++}`);
        params.push(v);

        if (v === "public") set.push(`published_at = NOW()`);
        else set.push(`published_at = NULL`);
      }

      set.push(`updated_at = NOW()`);

      const sql = `
          UPDATE public.videos
          SET ${set.join(", ")}
          WHERE id = $1
          RETURNING id
        `;

      const r = await client.query(sql, params);
      if (r.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Video not found" });
      }
      updatedVideo = r.rows[0];
    } else {
      const r = await client.query(`SELECT id FROM public.videos WHERE id = $1 LIMIT 1`, [videoId]);
      if (r.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Video not found" });
      }
    }

    // --- video_chairs ---
    // chairs: undefined => ne diraj, null => obriši sve chairs, array => replace
    // speakers: undefined => ne diraj, null => obriši sve speakers, array => replace
    const peopleResult = { chairs: undefined, speakers: undefined };


    if (isDefined(chairs) || isDefined(speakers)) {
      // normalize: null -> []
      const finalChairs = isDefined(chairs) ? (chairs === null ? [] : chairIds) : null;
      const finalSpeakers = isDefined(speakers) ? (speakers === null ? [] : speakerIds) : null;

      // Ako su oba poslata, izbegni overlap (prioritet: speakers)
      let chairsNoOverlap = finalChairs;
      if (finalChairs && finalSpeakers) {
        const spSet = new Set(finalSpeakers);
        chairsNoOverlap = finalChairs.filter((id) => !spSet.has(id));
      }

      // 1) CHAIRS (type=0): upsert + delete removed (samo ako je chairs poslato)
      if (chairsNoOverlap !== null) {
        await client.query(
          `
      WITH desired AS (
        SELECT unnest($2::uuid[]) AS person_id
      ),
      upserted AS (
        INSERT INTO public.video_chairs (video_id, person_id, type)
        SELECT $1, person_id, 0 FROM desired
        ON CONFLICT (video_id, person_id)
        DO UPDATE SET type = EXCLUDED.type
        RETURNING person_id
      )
      DELETE FROM public.video_chairs vc
      WHERE vc.video_id = $1
        AND vc.type = 0
        AND NOT EXISTS (SELECT 1 FROM desired d WHERE d.person_id = vc.person_id)
      `,
          [videoId, chairsNoOverlap]
        );
      }

      // 2) SPEAKERS (type=1): upsert + delete removed (samo ako je speakers poslato)
      if (finalSpeakers !== null) {
        await client.query(
          `
      WITH desired AS (
        SELECT unnest($2::uuid[]) AS person_id
      ),
      upserted AS (
        INSERT INTO public.video_chairs (video_id, person_id, type)
        SELECT $1, person_id, 1 FROM desired
        ON CONFLICT (video_id, person_id)
        DO UPDATE SET type = EXCLUDED.type
        RETURNING person_id
      )
      DELETE FROM public.video_chairs vc
      WHERE vc.video_id = $1
        AND vc.type = 1
        AND NOT EXISTS (SELECT 1 FROM desired d WHERE d.person_id = vc.person_id)
      `,
          [videoId, finalSpeakers]
        );
      }
    }

    await client.query("COMMIT");

    return res.json({
      success: true,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { });
    console.error("update video error:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
}




// GET /my/videos?page=1&limit=20&sort_by=visibility&sort_dir=asc
export async function handleGetMyVideos(req, res) {
  try {
    const userId = req.user?.sub || null;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const offset = (page - 1) * limit;

    const sortByRaw = String(req.query.sort_by || "created_at").toLowerCase();
    const sortDirRaw = String(req.query.sort_dir || "desc").toLowerCase();

    // whitelist: samo ove kolone smeju u ORDER BY
    const SORT_BY_MAP = {
      created_at: "created_at",
      view_count: "view_count",
      like_count: "like_count",
      visibility: "visibility",
    };

    const sortBy = SORT_BY_MAP[sortByRaw] || SORT_BY_MAP.created_at;
    const sortDir = sortDirRaw === "asc" ? "ASC" : "DESC";

    // total count
    const countRes = await writePool.query(
      `SELECT COUNT(*)::int AS total
       FROM public.videos
       WHERE uploaded_by = $1`,
      [userId]
    );
    const total = countRes.rows[0]?.total || 0;

    // paged rows
    const { rows } = await writePool.query(
      `
      SELECT
        id,
        title,
        description,
        thumbnail_url,
        duration_seconds,
        view_count,
        like_count,
        dislike_count,
        created_at,
        visibility
      FROM public.videos
      WHERE uploaded_by = $1
      ORDER BY ${sortBy} ${sortDir}, id DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    return res.json({
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      sort_by: sortByRaw,
      sort_dir: sortDirRaw,
      videos: rows,
    });
  } catch (err) {
    console.error("my videos route error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}



// DELETE /video/:videoId
export async function handleDeleteVideo(req, res) {
  try {
    const { videoId } = req.params;

    // 1) uzmi mux_asset_id iz baze
    const { rows } = await writePool.query(
      `SELECT mux_asset_id
       FROM public.videos
       WHERE id = $1
       LIMIT 1`,
      [videoId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Video not found" });
    }

    const muxAssetId = rows[0]?.mux_asset_id;
    if (!muxAssetId) {
      return res.status(400).json({ message: "Video has no mux_asset_id" });
    }

    // 2) obriši asset na Mux-u (asinkrono, webhook će posle obrisati DB)
    const muxResp = await fetch(`https://api.mux.com/video/v1/assets/${muxAssetId}`, {
      method: "DELETE",
      headers: {
        Authorization: muxBasicAuthHeader(),
        "Content-Type": "application/json",
      },
    });

    // Mux često vraća 204, može i 200, a 404 tretiraj kao "već obrisano"
    if (!muxResp.ok && muxResp.status !== 404) {
      const txt = await muxResp.text().catch(() => "");
      return res.status(502).json({
        message: "Mux API error (delete asset)",
        status: muxResp.status,
        details: txt?.slice(0, 500),
      });
    }

    // 3) ne brišemo DB ovde — webhook video.asset.deleted će odraditi brisanje + cascade
    return res.json({
      success: true,
      video_id: videoId,
      mux_asset_id: muxAssetId,
      message: "Delete requested on Mux. DB will be cleaned by webhook.",
    });
  } catch (err) {
    console.error("delete video route error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}



