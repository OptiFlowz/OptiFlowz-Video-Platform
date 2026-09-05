import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import * as usersController from './users.controller.js';

const router = express.Router();

router.get('/me/permissions', requireAuth, usersController.getMyPermissions);
router.get('/search', requireAuth, requirePermission(Permissions.USERS_SEARCH), usersController.searchUsers);
router.post('/assign-role', requireAuth, requirePermission(Permissions.USERS_ASSIGN_ROLES), usersController.assignRole);
router.delete('/remove-role', requireAuth, requirePermission(Permissions.USERS_ASSIGN_ROLES), usersController.removeRole);

export default router;
