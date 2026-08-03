import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import * as roleController from './role.controller.js';

const router = express.Router();
const requireRoleManagement = requirePermission(Permissions.ROLES_MANAGE);

router.get('/permissions', requireAuth, requireRoleManagement, roleController.getPermissions);
router.get('/', requireAuth, requireRoleManagement, roleController.getRoles);
router.post('/', requireAuth, requireRoleManagement, roleController.createRole);
router.patch('/:roleId', requireAuth, requireRoleManagement, roleController.updateRole);
router.delete('/:roleId', requireAuth, requireRoleManagement, roleController.deleteRole);

export default router;
