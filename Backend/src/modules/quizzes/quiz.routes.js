import express from 'express';
import { optionalAuth, requireAdmin , requireAuth} from '../../middleware/auth.js';
import * as quizController from './quiz.controller.js';

const router = express.Router();

router.post('/create', requireAuth,requireAdmin, quizController.createQuiz);
router.patch('/:quizId', requireAuth,requireAdmin, quizController.updateVideoQuiz);
router.delete('/:quizId',requireAuth, requireAdmin, quizController.deleteQuiz);
router.get('/user',requireAuth, requireAdmin, quizController.getUserQuizzes);
router.get('/:quizId/details', optionalAuth, quizController.getVideoQuiz);
router.get('/:quizId/questions', requireAuth, requireAdmin, quizController.getAllQuizQuestions);

router.post('/:quizId/question/create', requireAuth, requireAdmin, quizController.createQuizQuestion);
router.delete('/question/:questionId', requireAuth, requireAdmin, quizController.deleteQuizQuestion);
router.patch('/question/:questionId', requireAuth, requireAdmin, quizController.updateQuizQuestion);


// router.post('/:quizId/attempt/start',requireAuth, quizController.startQuizAttempt);
// router.get('/:quizId/attempts',requireAuth, quizController.getUserQuizAttempts);
// router.put('/attempt/:attemptId/question/:questionId/answer',requireAuth,quizController.saveQuizAttemptAnswer);



export default router;
