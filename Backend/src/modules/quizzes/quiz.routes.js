import express from 'express';
import { optionalAuth, requireAdmin , requireAuth} from '../../middleware/auth.js';
import * as quizController from './quiz.controller.js';

const router = express.Router();

router.post('/:videoId/create',requireAuth, quizController.createVideoQuiz);
router.patch('/:videoId/update', requireAuth, quizController.updateVideoQuiz);
router.delete('/:videoId/delete',requireAuth, quizController.deleteVideoQuiz);
router.get('/:videoId',optionalAuth, quizController.getVideoQuiz);

router.post('/:quizId/question/create', requireAuth, quizController.createQuizQuestion);
router.delete('/:quizId/question/:questionId', requireAuth, quizController.deleteQuizQuestion);
router.patch('/:quizId/question/:questionId', requireAuth, quizController.updateQuizQuestion);
router.get('/:quizId/questions', requireAuth, quizController.getAllQuizQuestions);

export default router;
