import express from 'express';
import { optionalAuth, requireAdmin , requireAuth} from '../../middleware/auth.js';
import * as peopleController from './people.controller.js';
import { personImageUploadMiddleware } from './handlers/uploadPersonImage.js';

const router = express.Router();

router.get('/:personId', optionalAuth, peopleController.getPersonById);
router.get('/search', optionalAuth, peopleController.searchPeople);
router.post('/create',requireAuth, requireAdmin, peopleController.createPerson);
router.patch('/:personId/image',requireAuth,requireAdmin,personImageUploadMiddleware,peopleController.uploadPersonImage);
router.patch('/:personId',requireAuth, requireAdmin, peopleController.updatePersonDetails);
router.delete('/:personId', requireAuth, peopleController.deletePerson);

export default router;