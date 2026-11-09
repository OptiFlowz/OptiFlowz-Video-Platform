import { writePool } from '../../../database/index.js';
import { buildVideoCardVisibilityWhere } from '../../../database/sql/videoCardFragments.js';
import { INDEX_VERSION, MODEL } from '../../video-indexing/documents.js';

const SEGMENTS_PER_VIDEO = 4;
const MIN_RELEVANCE = 0.35;

export async function queryTranscriptSegments(videoIds, section, embedding, { language, document_type } = {}) {
  const params = [videoIds, MODEL, INDEX_VERSION, section, SEGMENTS_PER_VIDEO, language ?? null, document_type ?? null];
  let score = 'NULL::double precision';
  let selection = `
    SELECT DISTINCT ON (video_id, bucket) *
    FROM (
      SELECT segments.*, ntile($5) OVER (PARTITION BY video_id ORDER BY start_seconds) AS bucket
      FROM segments
    ) sampled
    ORDER BY video_id, bucket, start_seconds`;

  if (embedding) {
    params.push(JSON.stringify(embedding), MIN_RELEVANCE);
    score = '1 - (d.embedding <=> $8::vector)';
    selection = `
      SELECT * FROM (
        SELECT segments.*, row_number() OVER (
          PARTITION BY video_id ORDER BY relevance DESC, start_seconds
        ) AS position
        FROM segments WHERE relevance >= $9
      ) ranked WHERE position <= $5`;
  }

  const { rows } = await writePool.query(`
    WITH candidates AS (
      SELECT d.id AS segment_id, v.id AS video_id, v.title AS video_title,
             d.language, d.document_type, d.metadata, d.text, d.start_seconds, d.end_seconds,
             ${score} AS relevance,
             COALESCE(NULLIF(v.duration_seconds, 0),
                      MAX(d.end_seconds) OVER (PARTITION BY v.id)) / 2.0 AS midpoint
      FROM videos v
      JOIN video_documents_pg d ON d.video_id = v.id
      JOIN video_indexing_sources s ON s.id = d.source_id
      WHERE v.id = ANY($1::uuid[]) AND ${buildVideoCardVisibilityWhere()}
        AND s.enabled
        AND ($6::text IS NULL OR lower(d.language) = lower($6))
        AND ($7::text IS NULL OR d.document_type = $7)
        AND d.source_revision = s.indexed_revision
        AND d.embedding_model = $2 AND d.index_version = $3
        ${embedding ? 'AND vector_norm(d.embedding) > 0' : ''}
    ), segments AS (
      SELECT DISTINCT ON (video_id, start_seconds) *
      FROM candidates
      WHERE $4 = 'whole'
         OR ($4 = 'first_half' AND start_seconds < midpoint)
         OR ($4 = 'second_half' AND (end_seconds > midpoint OR start_seconds >= midpoint))
      ORDER BY video_id, start_seconds, relevance DESC NULLS LAST, language, segment_id
    ), selected AS (${selection})
    SELECT segment_id, video_id, video_title, language, document_type, metadata, text, start_seconds, end_seconds
    FROM selected
    ORDER BY array_position($1::uuid[], video_id), relevance DESC NULLS LAST, start_seconds
  `, params);
  return rows;
}
