import { randomUUID } from 'node:crypto';
import { writePool } from '../../database/index.js';
import { transaction } from './indexing.service.js';
import { retrieveAsset } from './mux-source.service.js';
import {
  overviewDocuments,
  transcriptDocuments,
  contentHash,
  MODEL,
  INDEX_VERSION,
} from './documents.js';
import { embedTexts } from './embedding.service.js';
import { getMuxVttUrl } from '../videos/helpers/videoModeration.shared.js';

const LEASE_SECONDS = 120;

export async function claimJob() {
  // Exhausted jobs from crashed workers must reach a terminal state too.
  await writePool.query(`UPDATE video_indexing_jobs SET status='failed',finished_at=now(),
    locked_at=NULL,locked_until=NULL,lease_token=NULL,updated_at=now(),last_error='Worker lease expired; attempts exhausted'
    WHERE status='processing' AND locked_until<now() AND attempts>=max_attempts`);
  const { rows } = await writePool.query(
    `WITH candidate AS (
    SELECT id FROM video_indexing_jobs WHERE attempts<max_attempts AND
      ((status='pending' AND available_at<=now()) OR (status='processing' AND locked_until<now()))
    ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE video_indexing_jobs j SET status='processing',attempts=attempts+1,
    locked_at=now(),locked_until=now()+$1*interval '1 second',lease_token=$2,updated_at=now()
    FROM candidate WHERE j.id=candidate.id RETURNING j.*`,
    [LEASE_SECONDS, randomUUID()],
  );
  return rows[0];
}

async function renew(job) {
  const { rowCount } = await writePool.query(
    `UPDATE video_indexing_jobs j
    SET locked_until=now()+$3*interval '1 second',updated_at=now()
    FROM video_indexing_sources s WHERE j.id=$1 AND j.lease_token=$2
    AND j.status='processing' AND j.locked_until>now() AND s.id=j.source_id
    AND s.enabled AND s.desired_revision=j.requested_revision
    AND s.source_track_id IS NOT DISTINCT FROM j.source_track_id`,
    [job.id, job.lease_token, LEASE_SECONDS],
  );
  if (!rowCount) throw new Error('Indexing job is obsolete or lease was lost');
}

async function snapshot(job) {
  // Same lock order as edits and publication: video, source, job.
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT v.* FROM videos v JOIN video_indexing_sources s
      ON s.video_id=v.id WHERE s.id=$1 FOR UPDATE OF v`,
      [job.source_id],
    );
    const video = rows[0];
    const source = (
      await client.query('SELECT * FROM video_indexing_sources WHERE id=$1 FOR UPDATE', [
        job.source_id,
      ])
    ).rows[0];
    if (
      !video ||
      video.mux_status === 'deleted' ||
      !source?.enabled ||
      String(source.desired_revision) !== String(job.requested_revision) ||
      source.source_track_id !== job.source_track_id
    )
      throw new Error('Indexing source changed');
    return { video, source };
  });
}

export async function publishDocuments(job, source, documents) {
  return transaction(async (client) => {
    const video = (
      await client.query('SELECT id,mux_status FROM videos WHERE id=$1 FOR UPDATE', [
        source.video_id,
      ])
    ).rows[0];
    const current = (
      await client.query('SELECT * FROM video_indexing_sources WHERE id=$1 FOR UPDATE', [source.id])
    ).rows[0];
    const owned = (
      await client.query(
        `SELECT id FROM video_indexing_jobs WHERE id=$1
      AND status='processing' AND lease_token=$2 AND locked_until>clock_timestamp() FOR UPDATE`,
        [job.id, job.lease_token],
      )
    ).rows[0];
    if (
      !video ||
      video.mux_status === 'deleted' ||
      !owned ||
      !current?.enabled ||
      String(current.desired_revision) !== String(job.requested_revision) ||
      current.source_track_id !== job.source_track_id
    )
      throw new Error('Indexing result is obsolete');
    await client.query('DELETE FROM video_documents_pg WHERE source_id=$1', [source.id]);
    for (const [index, doc] of documents.entries()) {
      await client.query(
        `INSERT INTO video_documents_pg
        (source_id,video_id,document_type,language,source_revision,source_track_id,chunk_index,
         text,embedding,embedding_model,index_version,content_hash,start_seconds,end_seconds)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,$10,$11,$12,$13,$14)`,
        [
          source.id,
          source.video_id,
          source.document_type,
          source.language,
          job.requested_revision,
          job.source_track_id,
          index,
          doc.text,
          JSON.stringify(doc.embedding),
          MODEL,
          INDEX_VERSION,
          contentHash(doc.text),
          doc.start_seconds,
          doc.end_seconds,
        ],
      );
    }
    await client.query(
      `UPDATE video_indexing_sources SET indexed_revision=$2,updated_at=now() WHERE id=$1`,
      [source.id, job.requested_revision],
    );
    // Roll back the whole publication if the lease expired during inserts.
    const completed = await client.query(
      `UPDATE video_indexing_jobs SET status='completed',finished_at=now(),
      locked_at=NULL,locked_until=NULL,lease_token=NULL,last_error=NULL,updated_at=now()
      WHERE id=$1 AND lease_token=$2 AND locked_until>clock_timestamp()`,
      [job.id, job.lease_token],
    );
    if (!completed.rowCount) throw new Error('Lease expired during publication');
  });
}

async function failJob(job, error) {
  await writePool.query(
    `UPDATE video_indexing_jobs j SET
    status=CASE WHEN NOT EXISTS (SELECT 1 FROM video_indexing_sources s WHERE s.id=j.source_id
      AND s.enabled AND s.desired_revision=j.requested_revision
      AND s.source_track_id IS NOT DISTINCT FROM j.source_track_id) THEN 'cancelled'
      WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,
    finished_at=CASE WHEN attempts>=max_attempts OR NOT EXISTS
      (SELECT 1 FROM video_indexing_sources s WHERE s.id=j.source_id AND s.enabled
        AND s.desired_revision=j.requested_revision
        AND s.source_track_id IS NOT DISTINCT FROM j.source_track_id) THEN now() ELSE NULL END,
    available_at=now()+$3*interval '1 second',last_error=$4,
    locked_at=NULL,locked_until=NULL,lease_token=NULL,updated_at=now()
    WHERE id=$1 AND lease_token=$2 AND status='processing'`,
    [
      job.id,
      job.lease_token,
      Math.min(300, 5 * 2 ** (job.attempts - 1)),
      String(error.message).slice(0, 500),
    ],
  );
}

export async function processJob(job, signal) {
  try {
    await renew(job);
    const { video, source } = await snapshot(job);
    let documents;
    if (source.document_type === 'overview') documents = overviewDocuments(video);
    else {
      const asset = await retrieveAsset(video.mux_asset_id, signal);
      const track = asset?.tracks?.find(
        (t) => t.id === job.source_track_id && t.status === 'ready',
      );
      if (!track) throw new Error('Subtitle track is no longer ready');
      if (!video.mux_playback_id) throw new Error('Video playback is not ready');
      await renew(job);
      const url = await getMuxVttUrl(video.mux_playback_id, track.id, video.playback_policy);
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      });
      if (!response.ok) throw new Error(`Subtitle download failed (${response.status})`);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 10 * 1024 * 1024) throw new Error('Subtitle file exceeds 10 MB');
        chunks.push(chunk);
      }
      documents = transcriptDocuments(Buffer.concat(chunks).toString('utf8'));
    }
    // Reuse identical text from the current source without another paid API call.
    const { rows: existing } = await writePool.query(
      `SELECT content_hash,embedding::text FROM video_documents_pg
      WHERE source_id=$1 AND embedding_model=$2 AND index_version=$3`,
      [source.id, MODEL, INDEX_VERSION],
    );
    const cache = new Map(existing.map((d) => [d.content_hash, JSON.parse(d.embedding)]));
    const missing = new Map();
    for (const doc of documents) {
      const hash = contentHash(doc.text);
      if (!cache.has(hash)) missing.set(hash, doc.text);
    }
    const inputs = [...missing];
    for (let i = 0; i < inputs.length; i += 16) {
      signal.throwIfAborted();
      await renew(job);
      const batch = inputs.slice(i, i + 16);
      const vectors = await embedTexts(
        batch.map(([, text]) => text),
        signal,
      );
      batch.forEach(([hash], index) => cache.set(hash, vectors[index]));
    }
    await renew(job);
    signal.throwIfAborted();
    await publishDocuments(
      job,
      source,
      documents.map((doc) => ({ ...doc, embedding: cache.get(contentHash(doc.text)) })),
    );
    console.log(`[video-indexing] completed job=${job.id} documents=${documents.length}`);
  } catch (error) {
    await failJob(job, error);
    console.error(`[video-indexing] job=${job.id}: ${error.message}`);
  }
}
