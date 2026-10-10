import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as quizzesController from './quizzes.controller.js';

const router = express.Router();

router.use(requireAuth);
router.post('/', quizzesController.createQuiz);
router.get('/', quizzesController.getQuizzes);
router.get('/:quizId', quizzesController.getQuiz);
router.patch('/:quizId', quizzesController.updateQuiz);
router.delete('/:quizId', quizzesController.deleteQuiz);

export default router;
