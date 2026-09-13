import { HttpError } from '../../../../common/httpError.js';
import { writePool } from '../../../../database/index.js';
import {
  buildVideoCardJoins,
  buildVideoCardVisibilityWhere,
} from '../../../../database/sql/videoCardFragments.js';
import { MODEL, INDEX_VERSION } from '../../../video-indexing/documents.js';
import { withVideoCardMedia } from '../../helpers/videoCardMedia.js';

const RECENT_LIKES_LIMIT = 10;
const RECENT_WATCHES_LIMIT = 20;

export async function getPersonalizedRecommendationsVectorInternal(userId, limit = 20, page = 1) {
  if (!userId) throw new HttpError(401, { message: 'Authentication required' });
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

  // Bound each activity list before loading embeddings; do not fill gaps with
  // older activity when recent videos are not indexed yet.
  const { rows: profileRows } = await writePool.query(
    `WITH recent_likes AS (
      SELECT vr.video_id, 2 AS weight
      FROM video_reactions vr
      JOIN videos v ON v.id = vr.video_id
      WHERE vr.user_id = $1 AND vr.reaction = 1
        AND v.mux_status = 'ready'
        AND (v.visibility = 'public' OR (v.visibility = 'private' AND v.uploaded_by = $1))
      ORDER BY vr.created_at DESC NULLS LAST, vr.video_id
      LIMIT $4
    ), recent_watches AS (
      SELECT wp.video_id, 1 AS weight
      FROM watch_progress wp
      JOIN videos v ON v.id = wp.video_id
      WHERE wp.user_id = $1
        AND (wp.progress_seconds > 0 OR wp.percentage_watched > 0)
        AND v.mux_status = 'ready'
        AND (v.visibility = 'public' OR (v.visibility = 'private' AND v.uploaded_by = $1))
        AND NOT EXISTS (
          SELECT 1 FROM video_reactions vr
          WHERE vr.user_id = $1 AND vr.video_id = wp.video_id AND vr.reaction = -1
        )
      ORDER BY wp.last_watched_at DESC NULLS LAST, wp.video_id
      LIMIT $5
    ), seeds AS (
      SELECT video_id, MAX(weight) AS weight
      FROM (
        SELECT * FROM recent_likes
        UNION ALL
        SELECT * FROM recent_watches
      ) activity
      GROUP BY video_id
    ), seed_vectors AS (
      SELECT seeds.video_id, seeds.weight, COALESCE(
        AVG(d.embedding) FILTER (WHERE d.document_type = 'overview'),
        AVG(d.embedding) FILTER (WHERE d.document_type = 'transcript_chunk')
      ) AS embedding
      FROM seeds
      JOIN video_documents_pg d ON d.video_id = seeds.video_id
      JOIN video_indexing_sources s ON s.id = d.source_id
      WHERE s.enabled = TRUE
        AND d.source_revision = s.indexed_revision
        AND d.embedding_model = $2 AND d.index_version = $3
        AND vector_norm(d.embedding) > 0
      GROUP BY seeds.video_id, seeds.weight
    ), profile AS (
      SELECT AVG(l2_normalize(embedding)) AS embedding
      FROM seed_vectors
      CROSS JOIN LATERAL generate_series(1, weight) AS contribution
      WHERE vector_norm(embedding) > 0
    )
    SELECT CASE WHEN vector_norm(embedding) > 0 THEN embedding END AS embedding,
           ARRAY(SELECT video_id FROM seeds) AS seed_ids
    FROM profile`,
    [userId, MODEL, INDEX_VERSION, RECENT_LIKES_LIMIT, RECENT_WATCHES_LIMIT],
  );
  const profile = profileRows[0];
  if (!profile?.embedding) return { videos: [], total: 0, limit, page };

  const eligibleDocuments = `
    FROM videos v
    JOIN video_documents_pg d ON d.video_id = v.id
    JOIN video_indexing_sources s ON s.id = d.source_id
    WHERE ${buildVideoCardVisibilityWhere()}
      AND NOT (v.id = ANY($4::uuid[]))
      AND s.enabled = TRUE
      AND d.source_revision = s.indexed_revision
      AND d.embedding_model = $2 AND d.index_version = $3
      AND vector_norm(d.embedding) > 0
      AND NOT EXISTS (
        SELECT 1 FROM video_reactions vr
        WHERE vr.user_id = $1 AND vr.video_id = v.id AND vr.reaction IN (-1, 1)
      )
      AND NOT EXISTS (
        SELECT 1 FROM watch_progress wp
        WHERE wp.user_id = $1 AND wp.video_id = v.id AND wp.percentage_watched > 30
      )
  `;
  const filterParams = [userId, MODEL, INDEX_VERSION, profile.seed_ids];
  const embedding = typeof profile.embedding === 'string'
    ? profile.embedding
    : JSON.stringify(profile.embedding);

  const [{ rows }, { rows: countRows }] = await Promise.all([
    writePool.query(
      `WITH ranked AS (
        SELECT v.id, MAX(1 - (d.embedding <=> $5::vector)) AS personal_score
        ${eligibleDocuments}
        GROUP BY v.id
      )
      SELECT
        v.id, v.title, v.thumbnail_url, v.duration_seconds, v.view_count, v.created_at,
        u.full_name AS uploader_name,
        COALESCE(ppl.people, '[]'::json) AS people,
        wp.progress_seconds, wp.percentage_watched,
        ranked.personal_score
      ${buildVideoCardJoins({ includeWatchProgress: true, watchProgressUserParam: '$1' })}
      JOIN ranked ON ranked.id = v.id
      ORDER BY ranked.personal_score DESC, v.view_count DESC, v.created_at DESC, v.id
      LIMIT $6 OFFSET $7`,
      [...filterParams, embedding, limit, offset],
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
