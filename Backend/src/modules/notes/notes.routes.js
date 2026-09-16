import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import * as notesController from './notes.controller.js';

const router = express.Router();

router.use(requireAuth);
router.get('/video/:videoId', requirePermission(Permissions.NOTES_READ_OWN), notesController.getVideoNotes);
router.post('/', requirePermission(Permissions.NOTES_CREATE), notesController.createNote);
router.patch('/:id', requirePermission(Permissions.NOTES_EDIT_OWN), notesController.editNote);
router.delete('/:id', requirePermission(Permissions.NOTES_DELETE_OWN), notesController.deleteNote);

export default router;
