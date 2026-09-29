import Mux from '@mux/mux-node';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { scheduleOverview } from '../../video-indexing/indexing.service.js';
import { randomUUID } from 'node:crypto';
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../../storage/r2.client.js';

const LIVE_EVENTS = new Set(['created', 'connected', 'recording', 'active', 'disconnected', 'idle', 'updated', 'enabled', 'disabled', 'deleted'].map(t => `video.live_stream.${t}`));
const ASSET_EVENTS = new Set(['created', 'ready', 'updated', 'errored', 'deleted', 'live_stream_completed'].map(t => `video.asset.${t}`));
const terminal = s => ['ended', 'cancelled'].includes(s.status);
const time = v => v == null ? 0 : new Date(v).getTime();
const earliest = (a, b) => !a || time(b) < time(a) ? b : a;
const latest = (a, b) => !a || time(b) > time(a) ? b : a;
function eventTime(value) {
  const parsed = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, { message: 'Missing or invalid Mux event created_at' });
  return new Date(parsed).toISOString();
}

function finishSession(stream, at, completed = false) {
  if (stream.status === 'cancelled') return;
  // Delayed completion of an earlier recording must not close a new connection.
  if (!terminal(stream) && time(at) < time(stream.connected_at)) return;
  if (!terminal(stream) && stream.scheduled_at && time(at) < time(stream.scheduled_at)) {
    stream.status = 'scheduled';
    stream.started_at = null;
    stream.connected_at = null;
    stream.disconnected_at = null;
    stream.ended_at = null;
    stream.completed_at = null;
  } else {
    stream.status = 'ended';
    stream.ended_at = earliest(stream.ended_at, at);
    if (completed) stream.completed_at = earliest(stream.completed_at, at);
  }
  if (stream.mux_status !== 'disabled') stream.mux_status = 'idle';
  stream.mux_session_ended_at = latest(stream.mux_session_ended_at, at);
  stream.mux_event_at = latest(stream.mux_event_at, at);
}

function applyLiveEvent(stream, video, type, data, at) {
  const fresh = time(at) >= time(stream.mux_event_at);
  const afterSession = time(at) > time(stream.mux_session_ended_at);
  const differentAsset = data.active_asset_id && stream.mux_active_asset_id && data.active_asset_id !== stream.mux_active_asset_id;
  const oldRecording = video?.mux_recording_completed_at && (differentAsset || time(at) <= time(video.mux_recording_completed_at));
  // Preserve useful historical timestamps, but never restore a rehearsal's
  // timestamps after it has returned to scheduled.
  if ((afterSession || (terminal(stream) && !differentAsset)) && stream.status !== 'cancelled'
      && (!stream.ended_at || time(at) <= time(stream.ended_at))) {
    if (type === 'connected') stream.connected_at = latest(stream.connected_at, at);
    if (type === 'disconnected') stream.disconnected_at = latest(stream.disconnected_at, at);
    if (type === 'active') stream.started_at = earliest(stream.started_at, at);
  }
  if (oldRecording && !['deleted', 'disabled', 'enabled'].includes(type)) return;
  if (!fresh) return;
  const wasTerminal = terminal(stream);
  const connection = ['connected', 'recording', 'active'].includes(type);
  if (!stream.mux_active_asset_id && data.active_asset_id) stream.mux_active_asset_id = data.active_asset_id;
  if (connection && afterSession && !wasTerminal && !video?.mux_recording_completed_at) {
    if (data.active_asset_id) stream.mux_active_asset_id = data.active_asset_id;
  }
  switch (type) {
    case 'active':
    case 'connected':
    case 'recording':
      if (!wasTerminal && afterSession
          && !(stream.mux_status === 'disabled' && time(at) === time(stream.mux_event_at))
          && !(stream.status === 'disconnected' && time(at) === time(stream.disconnected_at))
          && (type === 'active' || data.status === 'active')) {
        stream.status = 'live'; stream.mux_status = 'active';
      }
      break;
    case 'disconnected':
      if (!wasTerminal && afterSession) {
        stream.status = 'disconnected';
        if (data.status === 'active') stream.mux_status = 'active';
      }
      break;
    case 'idle':
      if (stream.mux_status !== 'disabled') stream.mux_status = 'idle';
      if ((stream.started_at || stream.connected_at || data.active_asset_id)
          && (!differentAsset || !stream.mux_active_asset_id) && afterSession) finishSession(stream, at);
      break;
    case 'disabled': stream.mux_status = 'disabled'; break;
    case 'enabled':
      if (!wasTerminal && time(at) > time(stream.mux_event_at)) stream.mux_status = 'idle';
      break;
    case 'deleted':
      stream.mux_status = 'disabled';
      if (!wasTerminal) {
        stream.status = stream.started_at || stream.connected_at || stream.mux_active_asset_id ? 'ended' : 'cancelled';
        if (stream.status === 'ended') stream.ended_at = earliest(stream.ended_at, at);
      }
      break;
  }
  if (!wasTerminal) {
    const playback = data.playback_ids?.find(p => p.policy === stream.playback_policy)?.id;
    // The create/update handlers own this ID. A delayed snapshot must not restore
    // a revoked ID after changing policy away and back again.
    if (playback && !stream.mux_live_playback_id) stream.mux_live_playback_id = playback;
  }
  if (!['created', 'updated'].includes(type)) stream.mux_event_at = latest(stream.mux_event_at, at);
}

function applyAssetEvent(video, type, data, at) {
  if (type === 'live_stream_completed') video.mux_recording_completed_at = earliest(video.mux_recording_completed_at, at);
  if (video.mux_status === 'deleted') return;
  if (time(at) < time(video.mux_asset_event_at)) {
    if (type === 'live_stream_completed' && video.mux_status === 'preparing'
        && data.status === 'ready' && video.mux_playback_id) video.mux_status = 'ready';
    return;
  }
  const oldSnapshot = video.mux_recording_completed_at && ['created', 'ready', 'updated'].includes(type)
    && time(at) <= time(video.mux_recording_completed_at);
  if (oldSnapshot && !(type === 'ready' && time(at) === time(video.mux_recording_completed_at) && video.mux_status === 'preparing')) return;
  if (video.mux_status === 'errored' && time(at) === time(video.mux_asset_event_at) && !['errored', 'deleted'].includes(type)) return;
  if (type === 'deleted') {
    video.mux_status = 'deleted'; video.mux_playback_id = null;
  } else if (type === 'errored') {
    video.mux_status = 'errored';
  } else {
    if (type === 'created' && video.mux_asset_event_at) return;
    const playback = data.playback_ids?.find(p => p.policy === video.playback_policy)?.id;
    if (playback) video.mux_playback_id = playback;
    if (!oldSnapshot && typeof data.duration === 'number' && Number.isFinite(data.duration) && data.duration >= 0) video.duration_seconds = Math.round(data.duration);
    if (data.status === 'errored') video.mux_status = 'errored';
    else if ((type === 'ready' || data.status === 'ready') && video.mux_playback_id) video.mux_status = video.mux_recording_completed_at ? 'ready' : 'preparing';
  }
  video.mux_asset_event_at = latest(video.mux_asset_event_at, at);
}

async function ensureRecordingPlayback(video, data) {
  // Mux cannot update playback_policies in a live stream's new_asset_settings.
  // New recordings may therefore arrive with the stream's original policy.
  // Read current Mux state so webhook retries reuse any replacement already made.
  const assets = new Mux().video.assets;
  const options = { maxRetries: 0, timeout: 10000 };
  const asset = await assets.retrieve(video.mux_asset_id, options);
  let playback = asset.playback_ids?.find(p => p.policy === video.playback_policy);
  if (!playback) playback = await assets.createPlaybackId(video.mux_asset_id, { policy: video.playback_policy }, options);
  if (!playback?.id || playback.policy !== video.playback_policy) {
    throw new HttpError(502, { message: 'Mux returned an invalid recording playback ID' });
  }
  for (const old of asset.playback_ids ?? []) {
    if (old.policy === video.playback_policy) continue;
    try { await assets.deletePlaybackId(video.mux_asset_id, old.id, options); }
    catch (error) { if (error.status !== 404) throw error; }
  }
  return { ...data, playback_ids: [playback] };
}

export async function handleLiveStreamMuxEvent(event, candidateVideoId = null) {
  const isLive = LIVE_EVENTS.has(event.type), isAsset = ASSET_EVENTS.has(event.type);
  if (!isLive && !isAsset) return { handled: event.type.startsWith('video.live_stream.') };
  const data = event.data, type = event.type.split('.').at(-1);
  const liveId = isLive ? data.id || event.object?.id : data.live_stream_id || null;
  const assetId = isLive ? data.active_asset_id || null : data.id || event.object?.id;
  if ((isLive && !liveId) || (isAsset && !assetId)) throw new HttpError(400, { message: 'Missing Mux resource ID' });
  const client = await writePool.connect();
  let result;
  let copiedThumbnailKey;
  let commitStarted = false;
  try {
    await client.query('BEGIN');
    // Always lock the parent first: different recording webhooks and deletion
    // serialize without requiring one shared video row.
    const { rows } = await client.query(`SELECT ls.* FROM public.live_streams ls
      WHERE ($1::text IS NOT NULL AND ls.mux_live_stream_id=$1)
         OR ($1::text IS NULL AND ($2=ANY(ls.mux_deleted_asset_ids) OR EXISTS (
           SELECT 1 FROM public.videos v WHERE v.live_stream_id=ls.id
           AND (v.mux_asset_id=$2 OR (v.id=$3::uuid AND v.mux_asset_id IS NULL)))))
      FOR UPDATE OF ls`, [liveId, assetId, candidateVideoId]);
    const stream = rows[0];
    result = { handled: isLive || Boolean(liveId) || event.type === 'video.asset.live_stream_completed' || Boolean(stream) };
    if (stream) {
      const at = eventTime(event.created_at);
      let video;
      const deletedAsset = assetId && stream.mux_deleted_asset_ids.includes(assetId);
      if (assetId && !deletedAsset) {
        const existing = await client.query(`SELECT * FROM public.videos
          WHERE live_stream_id=$1 AND (mux_asset_id=$2 OR mux_asset_id IS NULL)
          ORDER BY (mux_asset_id IS NOT NULL) DESC, created_at LIMIT 1 FOR UPDATE`, [stream.id, assetId]);
        video = existing.rows[0];
        if (video) video.mux_asset_id = assetId;
        else {
          const videoId = randomUUID();
          let thumbnailUrl = null;
          if (stream.thumbnail_url) {
            const baseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
            const bucket = process.env.R2_BUCKET;
            if (!baseUrl || !bucket || !stream.thumbnail_url.startsWith(`${baseUrl}/`)) {
              throw new HttpError(500, { message: 'Livestream thumbnail is not in configured R2 storage' });
            }
            const sourceKey = stream.thumbnail_url.slice(baseUrl.length + 1);
            copiedThumbnailKey = `video-thumbnails/${videoId}/${randomUUID()}.webp`;
            await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: copiedThumbnailKey,
              CopySource: `${bucket}/${sourceKey}`.split('/').map(encodeURIComponent).join('/'),
            }), { abortSignal: AbortSignal.timeout(10000) });
            thumbnailUrl = `${baseUrl}/${copiedThumbnailKey}`;
          }
          const inserted = await client.query(`INSERT INTO public.videos
            (live_stream_id,uploaded_by,title,description,thumbnail_url,visibility,playback_policy,mux_asset_id,mux_status,published_at,id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'preparing',NULL,$9) RETURNING *`,
          [stream.id,stream.user_id,stream.title,stream.description,thumbnailUrl,stream.visibility,stream.playback_policy,assetId,videoId]);
          video = inserted.rows[0];
          // Commit the recording and its indexing job together. A webhook retry
          // reuses the existing video and does not schedule another overview.
          await scheduleOverview(client, video.id);
        }
      }
      if (video) {
        // Asset.created_at belongs to the recording, unlike event.created_at.
        // It identifies a new session even when its completion webhook arrives
        // before any of that session's live connection notifications.
        const started = isAsset && data.created_at != null
          ? eventTime(/^\d+(\.\d+)?$/.test(String(data.created_at)) ? Number(data.created_at) : data.created_at)
          : isLive && ['connected', 'recording', 'active'].includes(type) ? at : null;
        if (started) video.mux_recording_started_at = earliest(video.mux_recording_started_at, started);
      }
      const newBroadcast = isLive && ['enabled', 'connected', 'recording', 'active'].includes(type)
        && time(at) > Math.max(time(stream.mux_event_at), time(stream.ended_at), time(stream.completed_at));
      if (isLive) applyLiveEvent(stream, video, type, data, at);
      else if (video) {
        const alreadyCompleted = Boolean(video.mux_recording_completed_at);
        let assetData = data;
        if (['ready', 'updated', 'live_stream_completed'].includes(type)
            && (type === 'ready' || data.status === 'ready')
            && !['deleted', 'errored'].includes(video.mux_status) && !video.mux_playback_id
            && data.playback_ids?.length && !data.playback_ids.some(p => p.policy === video.playback_policy)) {
          assetData = await ensureRecordingPlayback(video, data);
        }
        applyAssetEvent(video, type, assetData, at);
        if (type === 'live_stream_completed' && !alreadyCompleted
            && !(stream.status === 'scheduled' && stream.mux_session_ended_at && stream.mux_active_asset_id === assetId)
            && (stream.mux_active_asset_id === assetId || (!stream.mux_active_asset_id && time(at) >= time(stream.mux_event_at))
              || (stream.status === 'scheduled' && time(video.mux_recording_started_at) > time(stream.mux_session_ended_at)
                && time(at) >= time(stream.mux_event_at)))) {
          stream.mux_active_asset_id = assetId;
          finishSession(stream, at, true);
        }
      }
      if (stream.status === 'ended' && newBroadcast) stream.mux_status = data.status === 'active' ? 'active' : 'idle';
      await client.query(`UPDATE public.live_streams SET status=$2,mux_status=$3,
        started_at=$4,ended_at=$5,connected_at=$6,disconnected_at=$7,completed_at=$8,
        mux_live_playback_id=$9,mux_event_at=$10,mux_active_asset_id=$11,mux_session_ended_at=$12,
        updated_at=now() WHERE id=$1`,
      [stream.id,stream.status,stream.mux_status,stream.started_at,stream.ended_at,stream.connected_at,
        stream.disconnected_at,stream.completed_at,stream.mux_live_playback_id,stream.mux_event_at,
        stream.mux_active_asset_id,stream.mux_session_ended_at]);
      if (video) {
        // Publish on the first completed/ready transition. Preserve explicit
        // publication dates and do not republish manually unpublished replays
        // when Mux retries an event for an already-ready recording.
        await client.query(`UPDATE public.videos SET mux_asset_id=$2,mux_playback_id=$3,mux_status=$4,
          duration_seconds=$5,thumbnail_url=$6,mux_asset_event_at=$7,mux_recording_completed_at=$8,mux_recording_started_at=$9,
          published_at=CASE WHEN $4='ready' AND $8::timestamptz IS NOT NULL
            AND (mux_status IS DISTINCT FROM 'ready' OR mux_recording_completed_at IS NULL)
            THEN COALESCE(published_at,now()) ELSE published_at END,
          updated_at=now() WHERE id=$1`, [video.id,video.mux_asset_id,video.mux_playback_id,video.mux_status,
          video.duration_seconds,video.thumbnail_url,video.mux_asset_event_at,video.mux_recording_completed_at,video.mux_recording_started_at]);
        if (isAsset && ['ready', 'live_stream_completed', 'updated'].includes(type)
            && video.mux_recording_completed_at && video.mux_status === 'ready') result.reconcile = { assetId, videoId: video.id };
      }
      if (stream.status === 'ended' && stream.mux_status !== 'disabled') result.disable = { id: stream.id, muxLiveStreamId: stream.mux_live_stream_id };
    }
    commitStarted = true;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (copiedThumbnailKey && !commitStarted) {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: copiedThumbnailKey }),
        { abortSignal: AbortSignal.timeout(10000) }).catch(() => console.warn('Unused recording thumbnail cleanup failed'));
    }
    throw error;
  } finally { client.release(); }
  if (result.disable) await disableEndedStream(result.disable);
  return result;
}

async function disableEndedStream({ id, muxLiveStreamId }) {
  try {
    await new Mux().video.liveStreams.disable(muxLiveStreamId, { maxRetries: 0, timeout: 4000 });
  } catch (error) {
    if (error.status !== 404) throw new HttpError(502, { message: 'Unable to disable ended Mux live stream' });
  }
  await writePool.query(`UPDATE public.live_streams SET mux_status = 'disabled', updated_at = now()
    WHERE id=$1 AND mux_live_stream_id=$2 AND status='ended'`, [id,muxLiveStreamId]);
}
