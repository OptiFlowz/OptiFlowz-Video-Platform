import express from 'express';
import { optionalAuth, requireAdmin , requireAuth} from '../../middleware/auth.js';
import * as quizController from './quiz.controller.js';

const router = express.Router();

router.post('/create',requireAuth, quizController.createQuiz);
router.patch('/:quizId', requireAuth, quizController.updateVideoQuiz);
router.delete('/:quizId',requireAuth, quizController.deleteQuiz);
router.get('/user',optionalAuth, quizController.getUserQuizzes);

router.post('/:quizId/question/create', requireAuth, quizController.createQuizQuestion);
router.delete('/question/:questionId', requireAuth, quizController.deleteQuizQuestion);
router.patch('/question/:questionId', requireAuth, quizController.updateQuizQuestion);
router.get('/:quizId/questions', requireAuth, quizController.getAllQuizQuestions);

// router.post('/:quizId/attempt/start',requireAuth, quizController.startQuizAttempt);
// router.get('/:quizId/attempts',requireAuth, quizController.getUserQuizAttempts);
// router.put('/attempt/:attemptId/question/:questionId/answer',requireAuth,quizController.saveQuizAttemptAnswer);



export default router;
