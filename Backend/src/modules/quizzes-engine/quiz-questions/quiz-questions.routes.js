import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as controller from './quiz-questions.controller.js';

const router = express.Router({ mergeParams: true });

router.use(requireAuth);
router.post('/', controller.createQuizQuestion);
router.get('/', controller.getQuizQuestions);
router.get('/:questionId', controller.getQuizQuestion);
router.patch('/:questionId', controller.updateQuizQuestion);
router.delete('/:questionId', controller.deleteQuizQuestion);

export default router;
