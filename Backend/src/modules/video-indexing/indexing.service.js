import { writePool } from '../../database/index.js';

export async function transaction(fn) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function enqueueSource(client, source) {
  await client.query(
    `UPDATE video_indexing_jobs SET status='cancelled', finished_at=now(),
    locked_at=NULL, locked_until=NULL, lease_token=NULL, updated_at=now()
    WHERE source_id=$1 AND requested_revision<>$2 AND status IN ('pending','processing')`,
    [source.id, source.desired_revision],
  );
  await client.query(
    `INSERT INTO video_indexing_jobs(source_id,requested_revision,source_track_id)
    VALUES ($1,$2,$3) ON CONFLICT (source_id,requested_revision) DO NOTHING`,
    [source.id, source.desired_revision, source.source_track_id],
  );
}

// Caller holds the video row lock and uses the same transaction as the edit.
export async function scheduleOverview(client, videoId) {
  const video = await client.query(
    "SELECT id FROM videos WHERE id=$1 AND mux_status IS DISTINCT FROM 'deleted' FOR UPDATE",
    [videoId],
  );
  if (!video.rowCount) return;
  const { rows } = await client.query(
    `INSERT INTO video_indexing_sources(video_id,document_type)
    VALUES ($1,'overview') ON CONFLICT (video_id) WHERE document_type='overview'
    DO UPDATE SET desired_revision=video_indexing_sources.desired_revision+1,
      enabled=true, updated_at=now() RETURNING *`,
    [videoId],
  );
  await enqueueSource(client, rows[0]);
}

export async function disableSource(client, sourceId) {
  await client.query(
    `UPDATE video_indexing_sources SET enabled=false,
    desired_revision=desired_revision+CASE WHEN enabled THEN 1 ELSE 0 END,
    updated_at=now() WHERE id=$1`,
    [sourceId],
  );
  await client.query('DELETE FROM video_documents_pg WHERE source_id=$1', [sourceId]);
  await client.query(
    `UPDATE video_indexing_jobs SET status='cancelled', finished_at=now(),
    locked_at=NULL,locked_until=NULL,lease_token=NULL,updated_at=now()
    WHERE source_id=$1 AND status IN ('pending','processing')`,
    [sourceId],
  );
}

// Keep a disabled track ID as a tombstone against delayed ready notifications.
export async function deleteIndexedTrack(videoId, language, trackId, deleteTrack) {
  return transaction(async (client) => {
    const video = await client.query('SELECT id FROM videos WHERE id=$1 FOR UPDATE', [videoId]);
    if (!video.rowCount) return;
    // Keep publication and reconciliation blocked until Mux deletion succeeds.
    // A failed Mux request rolls back without disabling the existing source.
    await deleteTrack();
    await client.query(
      `INSERT INTO video_indexing_sources
      (video_id,document_type,language,source_track_id,enabled)
      VALUES ($1,'transcript_chunk',$2,$3,false)
      ON CONFLICT (video_id,document_type,language) DO NOTHING`,
      [videoId, language, trackId],
    );
    const { rows } = await client.query(
      `SELECT id FROM video_indexing_sources
      WHERE video_id=$1 AND source_track_id=$2 FOR UPDATE`,
      [videoId, trackId],
    );
    for (const source of rows) await disableSource(client, source.id);
  });
}

export async function invalidateVideo(videoId) {
  return transaction(async (client) => {
    const video = await client.query('SELECT id FROM videos WHERE id=$1 FOR UPDATE', [videoId]);
    if (!video.rowCount) return;
    await client.query("UPDATE videos SET mux_status='deleted' WHERE id=$1", [videoId]);
    const { rows } = await client.query(
      'SELECT id FROM video_indexing_sources WHERE video_id=$1 FOR UPDATE',
      [videoId],
    );
    for (const source of rows) await disableSource(client, source.id);
  });
}
