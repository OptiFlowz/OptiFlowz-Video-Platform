import express from 'express';
import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import { requireCollectionAccess } from '../authorization/resource-authorization.js';
import * as collectionsController from './collections.controller.js';
import { collectionThumbnailUploadMiddleware } from './collections.middleware.js';

const router = express.Router();
const requireCollectionUpdate = requireCollectionAccess({
  ownPermission: Permissions.COLLECTIONS_UPDATE_OWN,
  anyPermission: Permissions.COLLECTIONS_UPDATE_ANY,
});
const requireCollectionDelete = requireCollectionAccess({
  ownPermission: Permissions.COLLECTIONS_DELETE_OWN,
  anyPermission: Permissions.COLLECTIONS_DELETE_ANY,
});

router.get('/', optionalAuth, collectionsController.getCollections);
router.get('/:collectionId', optionalAuth, collectionsController.getCollection);
router.use(requireAuth);
router.post('/', requirePermission(Permissions.COLLECTIONS_CREATE), collectionsController.createCollection);
router.patch('/:collectionId', requireCollectionUpdate, collectionsController.updateCollection);
router.post('/:collectionId/thumbnail', requireCollectionUpdate, collectionThumbnailUploadMiddleware, collectionsController.uploadCollectionThumbnail);
router.delete('/:collectionId', requireCollectionDelete, collectionsController.deleteCollection);
router.post('/:collectionId/playlists', requireCollectionUpdate, collectionsController.addCollectionPlaylists);
router.delete('/:collectionId/playlists/:playlistId', requireCollectionUpdate, collectionsController.removeCollectionPlaylist);
router.patch('/:collectionId/playlists/reorder', requireCollectionUpdate, collectionsController.reorderCollectionPlaylists);

export default router;
