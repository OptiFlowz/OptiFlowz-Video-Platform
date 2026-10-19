import { requireQuizResourceAccess as access } from '../helpers/quizAuthorization.js';
import { requirePermission } from '../../authorization/authorization.middleware.js';
import { Permissions } from '../../authorization/permission.constants.js';
import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as controller from './quiz-requirements.controller.js';

const router = express.Router();

router.use(requireAuth);
router.post('/', access('quizzes', 'update', { source: 'body', key: 'quiz_id' }), controller.createQuizRequirement);
router.get('/', access('quizzes', 'read', { source: 'query', key: 'quiz_id', list: true }), controller.getQuizRequirements);
router.get('/:quizId/check', requirePermission(Permissions.QUIZZES_PARTICIPATE), controller.checkQuizRequirements);
router.get('/:quizId/progress', requirePermission(Permissions.QUIZZES_PARTICIPATE), controller.getQuizRequirementsProgress);
router.get('/:quizId/:videoId', access('quizzes', 'read', { key: 'quizId' }), controller.getQuizRequirement);
router.patch('/:quizId/:videoId', access('quizzes', 'update', { key: 'quizId' }), controller.updateQuizRequirement);
router.delete('/:quizId/:videoId', access('quizzes', 'update', { key: 'quizId' }), controller.deleteQuizRequirement);

export default router;
