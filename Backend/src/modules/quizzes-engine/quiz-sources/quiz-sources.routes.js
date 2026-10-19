import { requireQuizResourceAccess as access } from '../helpers/quizAuthorization.js';
import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as controller from './quiz-sources.controller.js';

const router = express.Router({ mergeParams: true });

router.use(requireAuth);
router.post('/', access('quizzes', 'update', { key: 'quizId' }), controller.createQuizSource);
router.put('/', access('quizzes', 'update', { key: 'quizId' }), controller.replaceQuizSources);
router.get('/', access('quizzes', 'read', { key: 'quizId' }), controller.getQuizSources);
router.get('/:groupId', access('quizzes', 'read', { key: 'quizId' }), controller.getQuizSource);
router.patch('/:groupId', access('quizzes', 'update', { key: 'quizId' }), controller.updateQuizSource);
router.delete('/:groupId', access('quizzes', 'update', { key: 'quizId' }), controller.deleteQuizSource);

export default router;
