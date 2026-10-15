import { sendSuccess, sendError } from '../../common/response.js';
import { createCollectionInternal } from './handlers/createCollection.js';
import { getCollectionsInternal } from './handlers/getCollections.js';
import { getCollectionInternal } from './handlers/getCollection.js';
import { updateCollectionInternal } from './handlers/updateCollection.js';
import { deleteCollectionInternal } from './handlers/deleteCollection.js';
import { addCollectionPlaylistsInternal } from './handlers/addCollectionPlaylists.js';
import { removeCollectionPlaylistInternal } from './handlers/removeCollectionPlaylist.js';
import { reorderCollectionPlaylistsInternal } from './handlers/reorderCollectionPlaylists.js';
import { collectionThumbnailUploadInternal } from './handlers/collectionThumbnailUpload.js';

function handleCollectionError(res, error, action) {
  if (!error.status || error.status >= 500) console.error(`${action} error:`, error);
  return sendError(res,
    error.status && error.status < 500 ? error.message : 'Unable to process the collection request',
    error.status || 500,
  );
}

export async function createCollection(req, res) {
  try {
    const collection = await createCollectionInternal(req.body, req.user?.sub, req.authorization);
    return sendSuccess(res, { collection }, 201);
  } catch (error) {
    return handleCollectionError(res, error, 'createCollection');
  }
}

export async function getCollections(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getCollectionsInternal(req.query, req.user?.sub ?? null));
  } catch (error) { return handleCollectionError(res, error, 'getCollections'); }
}

export async function getCollection(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getCollectionInternal(req.params, req.user?.sub ?? null));
  } catch (error) { return handleCollectionError(res, error, 'getCollection'); }
}

export async function updateCollection(req, res) {
  try {
    const collection = await updateCollectionInternal(req.params, req.body, req.user?.sub, req.resourceAccess, req.authorization);
    return sendSuccess(res, { collection });
  } catch (error) { return handleCollectionError(res, error, 'updateCollection'); }
}

export async function deleteCollection(req, res) {
  try {
    return sendSuccess(res, await deleteCollectionInternal(req.params, req.user?.sub, req.resourceAccess));
  } catch (error) { return handleCollectionError(res, error, 'deleteCollection'); }
}

export async function addCollectionPlaylists(req, res) {
  try {
    return sendSuccess(res, await addCollectionPlaylistsInternal(req.params, req.body, req.user?.sub, req.resourceAccess), 201);
  } catch (error) { return handleCollectionError(res, error, 'addCollectionPlaylists'); }
}

export async function removeCollectionPlaylist(req, res) {
  try {
    return sendSuccess(res, await removeCollectionPlaylistInternal(req.params, req.user?.sub, req.resourceAccess));
  } catch (error) { return handleCollectionError(res, error, 'removeCollectionPlaylist'); }
}

export async function reorderCollectionPlaylists(req, res) {
  try {
    return sendSuccess(res, await reorderCollectionPlaylistsInternal(req.params, req.body, req.user?.sub, req.resourceAccess));
  } catch (error) { return handleCollectionError(res, error, 'reorderCollectionPlaylists'); }
}

export async function uploadCollectionThumbnail(req, res) {
  try {
    const collection = await collectionThumbnailUploadInternal(
      { params: req.params, file: req.file }, req.user?.sub, req.resourceAccess,
    );
    return sendSuccess(res, { collection });
  } catch (error) { return handleCollectionError(res, error, 'uploadCollectionThumbnail'); }
}
