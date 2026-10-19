import { requireQuizResourceAccess as access } from '../helpers/quizAuthorization.js';
import { requirePermission } from '../../authorization/authorization.middleware.js';
import { Permissions } from '../../authorization/permission.constants.js';
import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as quizzesController from './quizzes.controller.js';

const router = express.Router();

router.use(requireAuth);
router.post('/', requirePermission(Permissions.QUIZZES_CREATE), quizzesController.createQuiz);
router.get('/', access('quizzes', 'read', { list: true }), quizzesController.getQuizzes);
router.get('/:quizId', access('quizzes', 'read', { key: 'quizId' }), quizzesController.getQuiz);
router.patch('/:quizId', access('quizzes', 'update', { key: 'quizId' }), quizzesController.updateQuiz);
router.delete('/:quizId', access('quizzes', 'delete', { key: 'quizId' }), quizzesController.deleteQuiz);

export default router;
