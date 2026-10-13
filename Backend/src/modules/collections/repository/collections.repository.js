import { buildPlaylistCardSelect, buildPlaylistCardJoins } from '../../../database/sql/playlistCardFragments.js';

const COLLECTION_COLUMNS = 'id, title, subheading, description, visibility, thumbnail_url, created_by, created_at, updated_at';

export async function createCollection(database, userId, collection) {
  const { rows } = await database.query(`
    INSERT INTO public.collections (title, description, created_by, subheading, visibility)
    VALUES ($1, $2, $3, $4, $5) RETURNING ${COLLECTION_COLUMNS}
  `, [collection.title, collection.description, userId, collection.subheading, collection.visibility]);
  return rows[0];
}

export async function listCollections(database, { userId, title, visibility, sortBy, sortOrder, limit, offset }, viewerId = null) {
  const pattern = title ? `%${title.replace(/[\\%_]/g, '\\$&')}%` : null;
  const fields = { created_at: 'created_at', updated_at: 'updated_at', title: 'title' };
  const direction = sortOrder === 'desc' ? 'DESC' : 'ASC';
  const ordering = `${fields[sortBy]} ${direction}, id ASC`;
  const { rows } = await database.query(`
    WITH filtered_collections AS (
      SELECT ${COLLECTION_COLUMNS} FROM public.collections
      WHERE ($1::uuid IS NULL OR created_by = $1) AND ($2::text IS NULL OR title ILIKE $2)
        AND (visibility = 'public' OR created_by = $5::uuid)
        AND ($6::text IS NULL OR visibility = $6)
    ), page AS (
      SELECT * FROM filtered_collections ORDER BY ${ordering} LIMIT $3 OFFSET $4
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS collections,
      (SELECT count(*)::integer FROM filtered_collections) AS total
  `, [userId ?? null, pattern, limit, offset, viewerId, visibility ?? null]);
  return rows[0];
}

export async function getCollection(database, collectionId, viewerId = null) {
  // Read collection visibility and ordered playlist cards in the same database snapshot.
  const { rows } = await database.query(`
    SELECT to_jsonb(collection) AS collection, COALESCE(cards.playlists, '[]'::jsonb) AS playlists
    FROM (
      SELECT ${COLLECTION_COLUMNS} FROM public.collections
      WHERE id = $1 AND (visibility = 'public' OR created_by = $2::uuid)
    ) collection
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(to_jsonb(card) ORDER BY card.position, card.id) AS playlists
      FROM (
        ${buildPlaylistCardSelect()}, membership.position
        ${buildPlaylistCardJoins()}
        JOIN public.collection_playlists membership ON membership.playlist_id = p.id
        WHERE membership.collection_id = collection.id
          AND (p.status = 'public' OR (p.status = 'private' AND p.created_by = $2::uuid))
      ) card
    ) cards ON TRUE
  `, [collectionId, viewerId]);
  return rows[0] || null;
}

export async function updateCollection(database, collectionId, userId, updates, canAccessAny = false) {
  const { rows } = await database.query(`
    UPDATE public.collections SET title = COALESCE($3::text, title),
      description = CASE WHEN $4::boolean THEN $5::text ELSE description END,
      subheading = CASE WHEN $7::boolean THEN $8::text ELSE subheading END,
      visibility = COALESCE($9::text, visibility),
      updated_at = now()
    WHERE id = $1 AND (created_by = $2 OR $6::boolean)
    RETURNING ${COLLECTION_COLUMNS}
  `, [collectionId, userId, updates.title ?? null, updates.description !== undefined, updates.description ?? null,
    canAccessAny, updates.subheading !== undefined, updates.subheading ?? null, updates.visibility ?? null]);
  return rows[0] || null;
}

export async function deleteCollection(database, collectionId, userId, canAccessAny = false) {
  const { rowCount } = await database.query(`
    DELETE FROM public.collections WHERE id = $1 AND (created_by = $2 OR $3::boolean)
  `, [collectionId, userId, canAccessAny]);
  return rowCount > 0;
}

export async function lockCollection(database, collectionId, userId, canAccessAny = false) {
  // Serialize membership edits without blocking the FK key-share locks on this collection.
  const { rows } = await database.query(`
    SELECT ${COLLECTION_COLUMNS} FROM public.collections
    WHERE id = $1 AND (created_by = $2 OR $3::boolean) FOR NO KEY UPDATE
  `, [collectionId, userId, canAccessAny]);
  return rows[0] || null;
}

export async function lockReadablePlaylists(database, playlistIds, userId) {
  // Match playlist read visibility; adding a link must not expose another user's private playlist.
  const { rows } = await database.query(`
    SELECT id FROM public.playlists
    WHERE id = ANY($1::uuid[]) AND (status = 'public' OR (status = 'private' AND created_by = $2))
    ORDER BY id FOR SHARE
  `, [playlistIds, userId]);
  return rows.length === playlistIds.length;
}

export async function lockCollectionPlaylists(database, collectionId) {
  const { rows } = await database.query(`
    SELECT id, collection_id, playlist_id, position, created_at FROM public.collection_playlists
    WHERE collection_id = $1 ORDER BY position, id FOR UPDATE
  `, [collectionId]);
  return rows;
}

export async function insertCollectionPlaylists(database, collectionId, playlistIds, offset) {
  await database.query(`
    INSERT INTO public.collection_playlists (collection_id, playlist_id, position)
    SELECT $1, playlist_id, (ordinality - 1 + $3)::integer
    FROM unnest($2::uuid[]) WITH ORDINALITY AS requested(playlist_id, ordinality)
  `, [collectionId, playlistIds, offset]);
}

export async function removeCollectionPlaylist(database, collectionId, playlistId) {
  const { rowCount } = await database.query(`
    DELETE FROM public.collection_playlists WHERE collection_id = $1 AND playlist_id = $2
  `, [collectionId, playlistId]);
  return rowCount > 0;
}

export async function setCollectionPlaylistOrder(database, collectionId, playlistIds) {
  await database.query(`
    UPDATE public.collection_playlists AS item SET position = (requested.ordinality - 1)::integer
    FROM unnest($2::uuid[]) WITH ORDINALITY AS requested(playlist_id, ordinality)
    WHERE item.collection_id = $1 AND item.playlist_id = requested.playlist_id
  `, [collectionId, playlistIds]);
}

export async function touchCollection(database, collectionId) {
  const { rows } = await database.query(`
    UPDATE public.collections SET updated_at = now() WHERE id = $1 RETURNING ${COLLECTION_COLUMNS}
  `, [collectionId]);
  return rows[0];
}

export async function updateCollectionThumbnail(database, collectionId, thumbnailUrl) {
  const { rows } = await database.query(`
    UPDATE public.collections SET thumbnail_url = $2, updated_at = now()
    WHERE id = $1 RETURNING ${COLLECTION_COLUMNS}
  `, [collectionId, thumbnailUrl]);
  return rows[0];
}
