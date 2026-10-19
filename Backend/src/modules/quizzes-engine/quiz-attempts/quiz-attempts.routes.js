import { requirePermission } from '../../authorization/authorization.middleware.js';
import { Permissions } from '../../authorization/permission.constants.js';
import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import { getQuizEligibility, startQuizAttempt, getQuizAttempts } from './quiz-attempts.controller.js';

const router = express.Router();

router.get('/:quizId/eligibility', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), getQuizEligibility);
router.post('/:quizId/attempts', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), startQuizAttempt);
router.get('/:quizId/attempts', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), getQuizAttempts);

export default router;
