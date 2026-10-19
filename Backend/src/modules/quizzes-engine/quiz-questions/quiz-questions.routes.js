import { requireQuizResourceAccess as access } from '../helpers/quizAuthorization.js';
import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as controller from './quiz-questions.controller.js';

const router = express.Router({ mergeParams: true });

router.use(requireAuth);
router.post('/', access('quizzes', 'update', { key: 'quizId' }), controller.createQuizQuestion);
router.get('/', access('quizzes', 'read', { key: 'quizId' }), controller.getQuizQuestions);
router.get('/:questionId', access('quizzes', 'read', { key: 'quizId' }), controller.getQuizQuestion);
router.patch('/:questionId', access('quizzes', 'update', { key: 'quizId' }), controller.updateQuizQuestion);
router.delete('/:questionId', access('quizzes', 'update', { key: 'quizId' }), controller.deleteQuizQuestion);

export default router;
