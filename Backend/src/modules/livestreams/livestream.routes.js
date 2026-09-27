import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import { createLivestream, listLivestreams, listMyLivestreams, getLivestreamCredentials, endLivestream, updateLivestreamSettings } from './livestream.controller.js';
import { requireVideoAccess } from '../authorization/resource-authorization.js';

const router = express.Router();

router.post('/', requireAuth, requirePermission(Permissions.LIVESTREAMS_CREATE), createLivestream);
router.get('/', requireAuth, requirePermission(Permissions.LIVESTREAMS_LIBRARY_READ), listLivestreams);
router.get('/search', requireAuth, requirePermission(Permissions.LIVESTREAMS_LIBRARY_READ), listLivestreams);
router.get('/my', requireAuth, requirePermission(Permissions.LIVESTREAMS_UPDATE_OWN), listMyLivestreams);
const broadcast = requireVideoAccess({ ownPermission: Permissions.LIVESTREAMS_BROADCAST_OWN, anyPermission: Permissions.LIVESTREAMS_BROADCAST_ANY });
router.get('/:videoId/credentials', requireAuth, broadcast, getLivestreamCredentials);
router.post('/:videoId/end', requireAuth, broadcast, endLivestream);
router.patch('/:videoId/settings', requireAuth, requireVideoAccess({ ownPermission: Permissions.LIVESTREAMS_UPDATE_OWN, anyPermission: Permissions.LIVESTREAMS_UPDATE_ANY }), updateLivestreamSettings);

export default router;
