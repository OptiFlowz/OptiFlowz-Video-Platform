import express from 'express';
import { optionalAuth, requireAdmin , requireAuth} from '../../middleware/auth.js';
import * as quizController from './quiz.controller.js';

const router = express.Router();

router.post('/create',requireAdmin, quizController.createQuiz);
router.patch('/:quizId', requireAdmin, quizController.updateVideoQuiz);
router.delete('/:quizId',requireAdmin, quizController.deleteQuiz);
router.get('/user',requireAdmin, quizController.getUserQuizzes);

router.post('/:quizId/question/create', requireAdmin, quizController.createQuizQuestion);
router.delete('/question/:questionId', requireAdmin, quizController.deleteQuizQuestion);
router.patch('/question/:questionId', requireAdmin, quizController.updateQuizQuestion);
router.get('/:quizId/questions', requireAdmin, quizController.getAllQuizQuestions);

// router.post('/:quizId/attempt/start',requireAuth, quizController.startQuizAttempt);
// router.get('/:quizId/attempts',requireAuth, quizController.getUserQuizAttempts);
// router.put('/attempt/:attemptId/question/:questionId/answer',requireAuth,quizController.saveQuizAttemptAnswer);



export default router;
