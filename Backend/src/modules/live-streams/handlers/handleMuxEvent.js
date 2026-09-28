import Mux from '@mux/mux-node';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

const LIVE_EVENTS = new Set([
  'created', 'connected', 'recording', 'active', 'disconnected', 'idle',
  'updated', 'enabled', 'disabled', 'deleted',
].map(type => `video.live_stream.${type}`));
const ASSET_EVENTS = new Set([
  'created', 'ready', 'updated', 'errored', 'deleted', 'live_stream_completed',
].map(type => `video.asset.${type}`));
const terminal = stream => ['ended', 'cancelled'].includes(stream.status);
const time = value => value == null ? null : new Date(value).getTime();
const earliest = (a, b) => a == null || time(b) < time(a) ? b : a;
const latest = (a, b) => a == null || time(b) > time(a) ? b : a;

function eventTime(value) {
  const parsed = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, { message: 'Missing or invalid Mux event created_at' });
  return new Date(parsed).toISOString();
}

function applyLiveEvent(stream, video, type, data, at) {
  const fresh = stream.mux_event_at == null || time(at) >= time(stream.mux_event_at);
  const withinBroadcast = !stream.ended_at || time(at) <= time(stream.ended_at);
  // Capture historical timestamps even if another event arrived first.
  if (withinBroadcast && stream.status !== 'cancelled') {
    if (type === 'connected') stream.connected_at = latest(stream.connected_at, at);
    if (type === 'disconnected') stream.disconnected_at = latest(stream.disconnected_at, at);
    if (type === 'active') stream.started_at = earliest(stream.started_at, at);
  }
  if (!fresh) return;

  const wasTerminal = terminal(stream);
  switch (type) {
    case 'active':
      if (!wasTerminal && !(stream.mux_status === 'disabled' && time(at) === time(stream.mux_event_at))) {
        stream.status = 'live';
        stream.mux_status = 'active';
      }
      break;
    case 'connected':
    case 'recording':
    case 'disconnected':
      if (!wasTerminal && data.status === 'active'
          && !(stream.mux_status === 'disabled' && time(at) === time(stream.mux_event_at))) {
        stream.status = 'live';
        stream.mux_status = 'active';
      }
      break;
    case 'idle':
      if (stream.mux_status !== 'disabled') stream.mux_status = 'idle';
      // Initial idle/created notifications are not the end of an event.
      if (stream.status !== 'cancelled' && (stream.started_at || stream.connected_at || video.mux_asset_id)) {
        stream.status = 'ended';
        stream.ended_at = earliest(stream.ended_at, at);
      }
      break;
    case 'enabled':
      if (!wasTerminal && (stream.mux_event_at == null || time(at) > time(stream.mux_event_at))) {
        stream.mux_status = 'idle';
      }
      break;
    case 'disabled':
      stream.mux_status = 'disabled';
      break;
    case 'deleted':
      stream.mux_status = 'disabled';
      if (!wasTerminal) {
        stream.status = stream.started_at || stream.connected_at || video.mux_asset_id ? 'ended' : 'cancelled';
        if (stream.status === 'ended') stream.ended_at = earliest(stream.ended_at, at);
      }
      break;
    // Created/updated snapshots do not override explicit lifecycle events.
    default:
      break;
  }
  if (!wasTerminal) {
    const playbackId = data.playback_ids?.find(playback => playback.policy === video.playback_policy)?.id;
    if (playbackId) stream.mux_live_playback_id = playbackId;
  }
  // A metadata update must not suppress an earlier lifecycle notification.
  if (!['created', 'updated'].includes(type)) stream.mux_event_at = latest(stream.mux_event_at, at);
}

function applyAssetEvent(stream, video, type, data, at) {
  if (type === 'live_stream_completed') {
    stream.completed_at = earliest(stream.completed_at, at);
    if (stream.status !== 'cancelled') {
      stream.status = 'ended';
      stream.ended_at = earliest(stream.ended_at, at);
    }
    if (stream.mux_status !== 'disabled') stream.mux_status = 'idle';
  }
  if (video.mux_status === 'deleted') return false;
  if (stream.mux_asset_event_at && time(at) < time(stream.mux_asset_event_at)) {
    // A later ready notification may arrive before the completion notification.
    if (type === 'live_stream_completed' && video.mux_status === 'preparing'
        && data.status === 'ready' && video.mux_playback_id) video.mux_status = 'ready';
    return false;
  }
  // Created/ready snapshots can be delivered after the completion event, even
  // with the same timestamp. Never replace final duration with a live snapshot.
  if (stream.completed_at && ['created', 'ready', 'updated'].includes(type)
      && time(at) <= time(stream.completed_at)) {
    if (type === 'ready' && time(at) === time(stream.completed_at) && video.mux_status === 'preparing') {
      const playbackId = data.playback_ids?.find(playback => playback.policy === video.playback_policy)?.id;
      if (playbackId) {
        video.mux_playback_id = playbackId;
        video.mux_status = 'ready';
        if (!video.thumbnail_url) video.thumbnail_url = `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0`;
      }
    }
    return false;
  }
  if (video.mux_status === 'errored' && time(at) === time(stream.mux_asset_event_at)
      && !['errored', 'deleted'].includes(type)) return false;

  if (type === 'deleted') {
    video.mux_status = 'deleted';
    video.mux_playback_id = null;
  } else if (type === 'errored') {
    video.mux_status = 'errored';
  } else {
    if (type === 'created' && stream.mux_asset_event_at) return false;
    const playbackId = data.playback_ids?.find(playback => playback.policy === video.playback_policy)?.id;
    if (playbackId) video.mux_playback_id = playbackId;
    if (video.mux_playback_id && !video.thumbnail_url) {
      video.thumbnail_url = `https://image.mux.com/${video.mux_playback_id}/thumbnail.jpg?time=0`;
    }
    if (typeof data.duration === 'number' && Number.isFinite(data.duration) && data.duration >= 0) {
      video.duration_seconds = Math.round(data.duration);
    }
    // An asset is already playable for DVR while broadcasting. Only expose it
    // through the VOD handlers after finalization; publication remains explicit.
    if (data.status === 'errored') video.mux_status = 'errored';
    else if ((type === 'ready' || data.status === 'ready') && video.mux_playback_id) {
      video.mux_status = stream.completed_at ? 'ready' : 'preparing';
    }
  }
  stream.mux_asset_event_at = latest(stream.mux_asset_event_at, at);
  return true;
}

// Returns handled=false only for events belonging to ordinary uploaded videos.
// Live asset events must not fall through to the VOD deletion/publication path.
export async function handleLiveStreamMuxEvent(event, candidateVideoId = null) {
  const isLive = LIVE_EVENTS.has(event.type);
  const isAsset = ASSET_EVENTS.has(event.type);
  if (!isLive && !isAsset) return { handled: event.type.startsWith('video.live_stream.') };
  const data = event.data;
  const liveId = isLive ? data.id || event.object?.id : data.live_stream_id || null;
  const assetId = isLive ? data.active_asset_id || null : data.id || event.object?.id;
  if ((isLive && !liveId) || (isAsset && !assetId)) {
    throw new HttpError(400, { message: 'Missing Mux resource ID' });
  }

  const client = await writePool.connect();
  let result;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT row_to_json(ls) AS live_stream, row_to_json(v) AS video
       FROM public.live_streams ls JOIN public.videos v ON v.id = ls.video_id
       WHERE ($1::text IS NOT NULL AND ls.mux_live_stream_id = $1)
          OR ($1::text IS NULL AND (v.mux_asset_id = $2
              OR (v.id = $3::uuid AND v.mux_asset_id IS NULL)))
       FOR UPDATE OF v, ls`,
      [liveId, assetId, candidateVideoId],
    );
    if (!rows.length) {
      result = { handled: isLive || Boolean(liveId) || event.type === 'video.asset.live_stream_completed' };
    } else {
      const { live_stream: stream, video } = rows[0];
      result = { handled: true };
      const at = eventTime(event.created_at);
      const newBroadcastAttempt = isLive
        && ['enabled', 'connected', 'recording', 'active'].includes(event.type.split('.').at(-1))
        && time(at) > Math.max(time(stream.mux_event_at) || 0, time(stream.ended_at) || 0, time(stream.completed_at) || 0);
      const differentAsset = assetId && video.mux_asset_id && assetId !== video.mux_asset_id;
      // One application event owns one recording. Reusing the encoder key for a
      // later broadcast must not overwrite the previous event's replay.
      if (!differentAsset) {
        if (assetId && !video.mux_asset_id && video.mux_status !== 'deleted'
            && (!terminal(stream) || isAsset)) video.mux_asset_id = assetId;
        const type = event.type.split('.').at(-1);
        if (isLive) applyLiveEvent(stream, video, type, data, at);
        else applyAssetEvent(stream, video, type, data, at);

        await client.query(
          `UPDATE public.live_streams SET status=$2, mux_status=$3,
             started_at=$4, ended_at=$5, connected_at=$6, disconnected_at=$7,
             completed_at=$8, mux_live_playback_id=$9, mux_event_at=$10,
             mux_asset_event_at=$11, updated_at=now() WHERE id=$1`,
          [stream.id, stream.status, stream.mux_status, stream.started_at, stream.ended_at,
            stream.connected_at, stream.disconnected_at, stream.completed_at,
            stream.mux_live_playback_id, stream.mux_event_at, stream.mux_asset_event_at],
        );
        await client.query(
          `UPDATE public.videos SET mux_asset_id=$2, mux_playback_id=$3, mux_status=$4,
             duration_seconds=$5, thumbnail_url=$6, updated_at=now() WHERE id=$1`,
          [video.id, video.mux_asset_id, video.mux_playback_id, video.mux_status,
            video.duration_seconds, video.thumbnail_url],
        );
        // Repeat reconciliation on duplicate final/ready events so a failed
        // post-commit attempt can recover on Mux retry.
        if (isAsset && ['ready', 'live_stream_completed', 'updated'].includes(type)
            && stream.completed_at && video.mux_status === 'ready') {
          result.reconcile = { assetId: video.mux_asset_id, videoId: video.id };
        }
      }
      // Keep this outside the asset guard: a new broadcast on the same key must
      // also be disabled, even though its recording is intentionally ignored.
      if (stream.status === 'ended' && newBroadcastAttempt) {
        stream.mux_status = data.status === 'active' ? 'active' : 'idle';
        // Persist the need to disable again so a failed request remains
        // retryable even when this event's timestamp was already recorded.
        await client.query(
          'UPDATE public.live_streams SET mux_status=$2, updated_at=now() WHERE id=$1',
          [stream.id, stream.mux_status],
        );
      }
      if (stream.status === 'ended' && (stream.mux_status !== 'disabled' || newBroadcastAttempt)) {
        result.disable = { id: stream.id, muxLiveStreamId: stream.mux_live_stream_id };
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  // Do not hold row locks or a database connection during the Mux API request.
  // A failure leaves status=ended and is returned to Mux for webhook redelivery.
  if (result.disable) await disableEndedStream(result.disable);
  return result;
}

async function disableEndedStream({ id, muxLiveStreamId }) {
  try {
    await new Mux().video.liveStreams.disable(muxLiveStreamId, { maxRetries: 0, timeout: 4000 });
  } catch (error) {
    // A resource already deleted from Mux cannot accept encoder connections.
    if (error.status !== 404) {
      throw new HttpError(502, { message: 'Unable to disable ended Mux live stream' });
    }
  }
  await writePool.query(
    `UPDATE public.live_streams SET mux_status = 'disabled', updated_at = now()
     WHERE id = $1 AND mux_live_stream_id = $2 AND status = 'ended'`,
    [id, muxLiveStreamId],
  );
}
