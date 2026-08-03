import express from 'express';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import * as peopleController from './people.controller.js';
import { personImageUploadMiddleware } from './handlers/uploadPersonImage.js';

const router = express.Router();

router.get('/search', optionalAuth, peopleController.searchPeople);
router.post('/create', requireAuth, requirePermission(Permissions.PEOPLE_MANAGE), peopleController.createPerson);
router.patch('/:personId/image', requireAuth, requirePermission(Permissions.PEOPLE_MANAGE), personImageUploadMiddleware, peopleController.uploadPersonImage);
router.patch('/:personId', requireAuth, requirePermission(Permissions.PEOPLE_MANAGE), peopleController.updatePersonDetails);
router.delete('/:personId', requireAuth, requirePermission(Permissions.PEOPLE_MANAGE), peopleController.deletePerson);
router.get('/', optionalAuth, peopleController.getAllPeople);
router.get('/:personId', optionalAuth, peopleController.getPersonById);

export default router;
