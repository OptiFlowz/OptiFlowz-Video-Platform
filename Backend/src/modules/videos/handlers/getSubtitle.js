import { readPool } from '../../../database/index.js';
import { muxBasicAuthHeader } from '../helpers/videoModeration.shared.js';
import { HttpError } from '../../../common/httpError.js';

export async function getSubtitleInternal({ params: routeParams, query: queryParams }) {
  const responseHeaders = {};
  try {
    const { videoId } = routeParams;
    const lang = String(queryParams.lang || '')
      .trim()
      .toLowerCase();

    if (!lang) {
      throw new HttpError(400, { message: 'Missing query param: lang (e.g. ?lang=en)' });
    }

    const { rows } = await readPool.query(
      `
      SELECT mux_status, mux_asset_id, mux_playback_id
      FROM public.videos
      WHERE id = $1
      LIMIT 1
      `,
      [videoId],
    );

    const video = rows[0];
    if (!video) throw new HttpError(404, { message: 'Video not found' });

    const muxStatus = String(video.mux_status || '').toLowerCase();

    // ✅ prvo status iz baze
    if (muxStatus !== 'ready') {
      // ako želiš striktno:
      // return res.status(409).json({ code: "ASSET_NOT_READY", message: "Video is not ready yet", mux_status: muxStatus });

      return {
        status: 202,
        body: {
          code: 'ASSET_PROCESSING',
          message: 'Video is still processing on Mux',
          mux_status: muxStatus || null,
        },
        headers: responseHeaders,
        format: 'json',
      };
    }

    const assetId = video.mux_asset_id;
    const playbackId = video.mux_playback_id;

    if (!assetId || !playbackId) {
      throw new HttpError(400, {
        message: 'Video is missing mux_asset_id or mux_playback_id in DB',
      });
    }

    // --- Mux retrieve asset ---
    const muxResp = await fetch(`https://api.mux.com/video/v1/assets/${assetId}`, {
      method: 'GET',
      headers: {
        Authorization: muxBasicAuthHeader(),
        'Content-Type': 'application/json',
      },
    });

    if (!muxResp.ok) {
      const txt = await muxResp.text().catch(() => '');
      throw new HttpError(502, {
        message: 'Mux API error (retrieve asset)',
        status: muxResp.status,
        details: txt?.slice(0, 500),
      });
    }

    const muxJson = await muxResp.json();
    const tracks = muxJson?.data?.tracks || [];

    const wantedTrack =
      tracks.find(
        (t) =>
          t.type === 'text' &&
          (t.text_type === 'subtitles' || t.text_type === 'captions') &&
          String(t.language_code || '').toLowerCase() === lang,
      ) || null;

    // 1) track ne postoji
    if (!wantedTrack?.id) {
      throw new HttpError(404, {
        code: 'NO_CAPTIONS',
        message: 'Subtitle track for this language does not exist',
        lang,
      });
    }

    const trackId = wantedTrack.id;
    const trackStatus = String(wantedTrack.status || '').toLowerCase();

    // 2) track postoji ali nije ready
    if (trackStatus && trackStatus !== 'ready') {
      if (trackStatus === 'preparing') {
        return {
          status: 202,
          body: {
            code: 'CAPTIONS_PROCESSING',
            message: 'Captions are being generated',
            lang,
            track_id: trackId,
            track_status: trackStatus,
          },
          headers: responseHeaders,
          format: 'json',
        };
      }
      if (trackStatus === 'errored') {
        throw new HttpError(502, {
          code: 'CAPTIONS_ERRORED',
          message: 'Caption generation failed',
          lang,
          track_id: trackId,
          track_status: trackStatus,
        });
      }
      return {
        status: 202,
        body: {
          code: 'CAPTIONS_NOT_READY',
          message: 'Captions exist but are not ready yet',
          lang,
          track_id: trackId,
          track_status: trackStatus,
        },
        headers: responseHeaders,
        format: 'json',
      };
    }

    // 3) ready => fetch VTT
    const vttUrl = `https://stream.mux.com/${playbackId}/text/${trackId}.vtt`;
    const vttResp = await fetch(vttUrl);

    // ako stream endpoint kasni: tretiraj kao processing
    if (!vttResp.ok) {
      const txt = await vttResp.text().catch(() => '');
      if (vttResp.status === 404 || vttResp.status === 409) {
        return {
          status: 202,
          body: {
            code: 'CAPTIONS_PROCESSING',
            message: 'Captions are being generated (VTT not available yet)',
            lang,
            track_id: trackId,
            vtt_status: vttResp.status,
          },
          headers: responseHeaders,
          format: 'json',
        };
      }
      throw new HttpError(502, {
        message: 'Failed to fetch VTT from Mux stream endpoint',
        status: vttResp.status,
        details: txt?.slice(0, 500),
        vtt_url: vttUrl,
      });
    }

    const vttText = await vttResp.text();

    responseHeaders['Content-Type'] = 'text/vtt; charset=utf-8';
    responseHeaders['X-Mux-Track-Id'] = trackId;
    responseHeaders['X-Mux-Lang'] = lang;
    responseHeaders['X-Mux-VTT-Url'] = vttUrl;
    return { status: 200, body: vttText, headers: responseHeaders, format: 'send' };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('subtitle route error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
