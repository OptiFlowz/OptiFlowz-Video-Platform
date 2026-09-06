import { S3Client } from '@aws-sdk/client-s3';
import { Agent } from 'undici';

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;

const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;

const R2_ENDPOINT = process.env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

export const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT, // https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com
  forcePathStyle: true, // ✅ ključno
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

export const R2_BUCKET = process.env.R2_BUCKET;

export const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

export function muxBasicAuthHeader() {
  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;
  const b64 = Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64');
  return `Basic ${b64}`;
}

function muxAuthHeader() {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  const b64 = Buffer.from(`${id}:${secret}`).toString('base64');
  return `Basic ${b64}`;
}

export async function muxGetAsset(assetId) {
  const resp = await fetch(`https://api.mux.com/video/v1/assets/${assetId}`, {
    headers: {
      Authorization: muxAuthHeader(),
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`MUX_GET_ASSET_FAILED:${resp.status}:${txt.slice(0, 300)}`);
  }

  return resp.json();
}

export async function muxDeleteTrack(assetId, trackId) {
  const resp = await fetch(`https://api.mux.com/video/v1/assets/${assetId}/tracks/${trackId}`, {
    method: 'DELETE',
    headers: { Authorization: muxAuthHeader() },
  });

  // Mux uglavnom vraća 204, ali i 200 može – tretiraj ok ako je ok
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`MUX_DELETE_TRACK_FAILED:${resp.status}:${txt.slice(0, 300)}`);
  }
}

export async function muxCreateTextTrack(
  assetId,
  url,
  { language_code, name, text_type = 'subtitles' } = {},
) {
  const body = {
    url,
    type: 'text',
    text_type, // "subtitles" ili "captions"
    closed_captions: false,
    language_code: language_code || 'en',
    name: name || `Subtitles (${language_code || 'en'})`,
  };

  const resp = await fetch(`https://api.mux.com/video/v1/assets/${assetId}/tracks`, {
    method: 'POST',
    headers: {
      Authorization: muxAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`MUX_CREATE_TRACK_FAILED:${resp.status}:${txt.slice(0, 300)}`);
  }

  return resp.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitForTrackReady(assetId, trackId, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const assetJson = await muxGetAsset(assetId);
    const track = (assetJson?.data?.tracks || []).find((t) => t.id === trackId);

    const status = track?.status; // "preparing" | "ready" | "errored" | "deleted" :contentReference[oaicite:1]{index=1}
    if (status === 'ready') return { ok: true, status };
    if (status === 'errored') return { ok: false, status, errors: assetJson?.data?.errors };

    await sleep(2000); // 2s
  }
  return { ok: false, status: 'timeout' };
}

export function sanitizeLang(lang) {
  return String(lang || '')
    .trim()
    .toLowerCase();
}

export function sanitizeName(name, fallback) {
  const n = String(name || '').trim();
  return (n.length ? n : fallback).slice(0, 80);
}

export function pickTextTrackByLang(tracks, lang) {
  const l = sanitizeLang(lang);

  return (
    tracks.find(
      (t) =>
        t.type === 'text' &&
        (t.text_type === 'subtitles' || t.text_type === 'captions') &&
        String(t.language_code || '').toLowerCase() === l,
    ) || null
  );
}

export async function fetchVttFromMux(playbackId, trackId) {
  const vttUrl = `https://stream.mux.com/${playbackId}/text/${trackId}.vtt`;
  const resp = await fetch(vttUrl);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`MUX_FETCH_VTT_FAILED:${resp.status}:${txt.slice(0, 300)}`);
  }
  const vttText = await resp.text();
  return { vttText, vttUrl };
}

export function ensureWebVttHeader(vttText) {
  const s = String(vttText || '')
    .replace(/^\uFEFF/, '')
    .trimStart(); // remove BOM if any
  if (s.toUpperCase().startsWith('WEBVTT')) return s;
  return `WEBVTT\n\n${s}`;
}

const n8nAgent = new Agent({
  connect: { timeout: 30_000 }, // connect timeout
  headersTimeout: 35 * 60 * 1000, // čekanje na response HEADERS
  bodyTimeout: 35 * 60 * 1000, // čekanje na BODY posle headers
});

export async function callN8nTranslateVtt({ sourceVtt, targetLang, name, videoId }) {
  const webhookUrl = process.env.N8N_TRANSLATE_SUBS_WEBHOOK;
  if (!webhookUrl) throw new Error('N8N_WEBHOOK_NOT_CONFIGURED');

  const token = process.env.N8N_TRANSLATE_SUBS_BEARER_TOKEN;
  if (!token) throw new Error('N8N_BEARER_NOT_CONFIGURED');
  // timeout safety
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20 * 60 * 1000);
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      dispatcher: n8nAgent, // 👈 bitno
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${token}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        videoId,
        sourceLang: 'en',
        targetLang,
        name,
        vtt: sourceVtt,
      }),
    });

    const text = await resp.text().catch(() => '');
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
      throw new Error('N8N_RETURNED_EMPTY_VTT');
    }

    return String(outVtt);
  } finally {
    clearTimeout(t);
  }
}

export function extractKeyFromPublicUrl(url) {
  if (!url || !R2_PUBLIC_BASE_URL) return null;
  if (!url.startsWith(R2_PUBLIC_BASE_URL + '/')) return null;
  return url.slice((R2_PUBLIC_BASE_URL + '/').length);
}
