import { requirePermission } from '../../authorization/authorization.middleware.js';
import { Permissions } from '../../authorization/permission.constants.js';
import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import { getQuizEligibility, startQuizAttempt, getQuizAttempts, saveQuizAttemptAnswer, getQuizAttemptQuestions } from './quiz-attempts.controller.js';

const router = express.Router();
// Attempt resources use /api/quiz-attempts; quiz-scoped operations stay below.
export const quizAttemptAnswerRoutes = express.Router();
quizAttemptAnswerRoutes.get('/:attemptId/questions', requireAuth,
  requirePermission(Permissions.QUIZZES_PARTICIPATE), getQuizAttemptQuestions);
quizAttemptAnswerRoutes.put('/:attemptId/answers/:questionNo', requireAuth,
  requirePermission(Permissions.QUIZZES_PARTICIPATE), saveQuizAttemptAnswer);

router.get('/:quizId/eligibility', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), getQuizEligibility);
router.post('/:quizId/attempts', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), startQuizAttempt);
router.get('/:quizId/attempts', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), getQuizAttempts);

export default router;
