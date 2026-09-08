import { getMyPlaylistsInternal } from './handlers/getMyPlaylists.js';
import { patchPlaylistDetailsInternal } from './handlers/patchPlaylistDetails.js';
import { playlistThumbnailUploadInternal } from './handlers/playlistThumbnailUpload.js';
import { addVideoToPlaylistInternal } from './handlers/addVideoToPlaylist.js';
import { removeVideoFromPlaylistInternal } from './handlers/removeVideoFromPlaylist.js';
import { movePlaylistItemInternal } from './handlers/movePlaylistItem.js';
import { reorderPlaylistItemsInternal } from './handlers/reorderPlaylistItems.js';
import { deletePlaylistInternal } from './handlers/deletePlaylist.js';
import { createPlaylistInternal } from './handlers/createPlaylist.js';

export async function handleGetMyPlaylists(req, res) {
  try {
    const result = await getMyPlaylistsInternal({ query: req.query }, req.user?.sub || null);
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handlePatchPlaylistDetails(req, res) {
  try {
    const result = await patchPlaylistDetailsInternal({ params: req.params, body: req.body });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handlePlaylistThumbnailUpload(req, res) {
  try {
    const result = await playlistThumbnailUploadInternal({ params: req.params, file: req.file });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function addVideoToPlaylist(req, res) {
  try {
    const result = await addVideoToPlaylistInternal({ params: req.params, body: req.body });
    return res.status(201).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function removeVideoFromPlaylist(req, res) {
  try {
    const result = await removeVideoFromPlaylistInternal({ params: req.params });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function movePlaylistItem(req, res) {
  try {
    const result = await movePlaylistItemInternal({ params: req.params, body: req.body });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function reorderPlaylistItems(req, res) {
  try {
    const result = await reorderPlaylistItemsInternal({ params: req.params, body: req.body });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleDeletePlaylist(req, res) {
  try {
    const result = await deletePlaylistInternal(
      { params: req.params, resourceAccess: req.resourceAccess },
      req.user?.sub || null,
    );
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleCreatePlaylist(req, res) {
  try {
    const result = await createPlaylistInternal({ body: req.body }, req.user?.sub || null);
    return res.status(201).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}
