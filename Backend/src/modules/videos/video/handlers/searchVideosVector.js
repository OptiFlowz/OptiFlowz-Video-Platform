import { HttpError } from '../../../../common/httpError.js';
import { writePool } from '../../../../database/index.js';
import {
  buildVideoCardJoins,
  buildVideoCardVisibilityWhere,
} from '../../../../database/sql/videoCardFragments.js';
import { embedTexts } from '../../../video-indexing/embedding.service.js';
import { MODEL, INDEX_VERSION } from '../../../video-indexing/documents.js';
import { withVideoCardMedia } from '../../helpers/videoCardMedia.js';
import { searchVideosInternal } from './searchVideos.js';

export async function searchVideosVectorInternal(searchParams, userId = null) {
  const {
    query,
    category,
    tags,
    person,
    sortBy = 'relevance',
    limit = 20,
    offset = 0,
  } = searchParams;
  const searchQuery = query?.trim();

  if (!searchQuery) return searchVideosInternal(searchParams, userId);
  if (Buffer.byteLength(searchQuery, 'utf8') > 6000) {
    throw new HttpError(400, { message: 'q must not exceed 6000 UTF-8 bytes' });
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new HttpError(503, { message: 'Vector search is not configured' });
  }

  let embedding;
  try {
    [embedding] = await embedTexts([searchQuery], new AbortController().signal);
  } catch {
    throw new HttpError(502, { message: 'Could not embed the search query. Please try again.' });
  }

  const filterParams = [MODEL, INDEX_VERSION];
  const bindFilter = (value) => `$${filterParams.push(value)}`;
  let eligibleDocuments = `
    FROM videos v
    JOIN video_documents_pg d ON d.video_id = v.id
    JOIN video_indexing_sources s ON s.id = d.source_id
    WHERE ${buildVideoCardVisibilityWhere()}
      AND s.enabled = TRUE
      AND d.source_revision = s.indexed_revision
      AND d.embedding_model = $1
      AND d.index_version = $2
  `;

  if (category) {
    eligibleDocuments += ` AND EXISTS (
      SELECT 1 FROM video_categories vc
      WHERE vc.video_id = v.id AND vc.category_id = ${bindFilter(category)}
    )`;
  }
  if (tags?.length) eligibleDocuments += ` AND v.tags && ${bindFilter(tags)}`;
  if (person) {
    eligibleDocuments += ` AND EXISTS (
      SELECT 1 FROM video_chairs vc
      WHERE vc.video_id = v.id AND vc.person_id = ${bindFilter(person)}
    )`;
  }

  const params = [...filterParams];
  const bind = (value) => `$${params.push(value)}`;
  const vectorParam = bind(JSON.stringify(embedding));
  const userParam = userId ? bind(userId) : null;
  const orderBy = {
    relevance: 'ranked.relevance DESC, v.created_at DESC, v.id',
    date: 'v.created_at DESC, v.id',
    views: 'v.view_count DESC, v.id',
    likes: 'v.like_count DESC, v.id',
  };
  const order = Object.hasOwn(orderBy, sortBy) ? orderBy[sortBy] : orderBy.date;

  // Use the primary database so visibility and source invalidation are current.
  // Keep the last published revision searchable while its replacement is queued.
  const [{ rows }, { rows: countRows }] = await Promise.all([
    writePool.query(
      `WITH ranked AS (
        SELECT v.id, MAX(1 - (d.embedding <=> ${vectorParam}::vector)) AS relevance
        ${eligibleDocuments}
        GROUP BY v.id
      )
      SELECT
        v.id, v.title, v.thumbnail_url, v.duration_seconds, v.view_count, v.created_at,
        u.full_name AS uploader_name,
        COALESCE(ppl.people, '[]'::json) AS people,
        ranked.relevance
        ${userId ? ', wp.progress_seconds, wp.percentage_watched' : ''}
      ${buildVideoCardJoins({
        includeWatchProgress: Boolean(userId),
        watchProgressUserParam: userParam,
      })}
      JOIN ranked ON ranked.id = v.id
      ORDER BY ${order}
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
      params,
    ),
    writePool.query(
      `SELECT COUNT(DISTINCT v.id) AS total ${eligibleDocuments}`,
      filterParams,
    ),
  ]);

  return {
    videos: await withVideoCardMedia(rows, userId),
    total: Number(countRows[0].total),
    limit,
    offset,
  };
}
