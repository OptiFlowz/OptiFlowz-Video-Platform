import { HttpError } from '../../../../common/httpError.js';
import { writePool } from '../../../../database/index.js';
import {
  buildVideoCardJoins,
  buildVideoCardVisibilityWhere,
} from '../../../../database/sql/videoCardFragments.js';
import { MODEL, INDEX_VERSION } from '../../../video-indexing/documents.js';
import { withVideoCardMedia } from '../../helpers/videoCardMedia.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getSimilarVideosVectorInternal(videoId, userId = null, limit = 20, page = 1) {
  if (typeof videoId !== 'string' || !UUID_PATTERN.test(videoId)) {
    throw new HttpError(400, { message: 'Invalid video ID' });
  }
  for (const [name, value] of Object.entries({ limit, page })) {
    if (
      !['string', 'number'].includes(typeof value) ||
      !/^\d+$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < 1
    ) {
      throw new HttpError(400, { message: `${name} must be a positive integer` });
    }
  }
  limit = Math.min(Number(limit), 100);
  page = Number(page);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    throw new HttpError(400, { message: 'Requested page is too large' });
  }

  // Apply the same source-video access rules as getVideoById on the primary.
  // Prefer its overview; captions alone can still provide a representative vector.
  const { rows: sourceRows } = await writePool.query(
    `SELECT v.id,
       CASE WHEN vector_norm(reference.embedding) > 0 THEN reference.embedding END AS embedding
     FROM videos v
     LEFT JOIN LATERAL (
       SELECT COALESCE(
         AVG(d.embedding) FILTER (WHERE d.document_type = 'overview'),
         AVG(d.embedding) FILTER (WHERE d.document_type = 'transcript_chunk')
       ) AS embedding
       FROM video_documents_pg d
       JOIN video_indexing_sources s ON s.id = d.source_id
       WHERE d.video_id = v.id
         AND s.enabled = TRUE
         AND d.source_revision = s.indexed_revision
         AND d.embedding_model = $3
         AND d.index_version = $4
         AND vector_norm(d.embedding) > 0
     ) reference ON TRUE
     WHERE v.id = $1 AND v.mux_status = 'ready'
       AND ((v.visibility = 'public' AND v.published_at <= NOW()) OR (v.visibility IN ('public', 'private') AND v.uploaded_by = $2))`,
    [videoId, userId, MODEL, INDEX_VERSION],
  );
  if (!sourceRows.length) throw new HttpError(404, { message: 'Video not found' });
  const embedding = sourceRows[0].embedding;
  if (!embedding) return { videos: [], total: 0, limit, page };

  const eligibleDocuments = `
    FROM videos v
    JOIN video_documents_pg d ON d.video_id = v.id
    JOIN video_indexing_sources s ON s.id = d.source_id
    WHERE v.id <> $1
      AND ${buildVideoCardVisibilityWhere()}
      AND s.enabled = TRUE
      AND d.source_revision = s.indexed_revision
      AND d.embedding_model = $2
      AND d.index_version = $3
      AND vector_norm(d.embedding) > 0
  `;
  const filterParams = [videoId, MODEL, INDEX_VERSION];
  // pg returns vectors as strings unless a vector type parser is registered.
  const vector = typeof embedding === 'string' ? embedding : JSON.stringify(embedding);
  const params = [...filterParams, vector, limit, offset];
  if (userId) params.push(userId);

  const [{ rows }, { rows: countRows }] = await Promise.all([
    writePool.query(
      `WITH ranked AS (
        SELECT v.id, MAX(1 - (d.embedding <=> $4::vector)) AS similarity_score
        ${eligibleDocuments}
        GROUP BY v.id
      )
      SELECT
        v.id, v.title, v.thumbnail_url, v.duration_seconds, v.view_count, v.created_at,
        u.full_name AS uploader_name,
        COALESCE(ppl.people, '[]'::json) AS people,
        ranked.similarity_score
        ${userId ? ', wp.progress_seconds, wp.percentage_watched' : ''}
      ${buildVideoCardJoins({
        includeWatchProgress: Boolean(userId),
        watchProgressUserParam: userId ? '$7' : null,
      })}
      JOIN ranked ON ranked.id = v.id
      ORDER BY ranked.similarity_score DESC, v.view_count DESC, v.created_at DESC, v.id
      LIMIT $5 OFFSET $6`,
      params,
    ),
    writePool.query(`SELECT COUNT(DISTINCT v.id) AS total ${eligibleDocuments}`, filterParams),
  ]);

  return {
    videos: await withVideoCardMedia(rows, userId),
    total: Number(countRows[0].total),
    limit,
    page,
  };
}
