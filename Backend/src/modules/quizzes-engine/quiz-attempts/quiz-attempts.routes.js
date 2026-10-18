import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import { getQuizEligibility, startQuizAttempt } from './quiz-attempts.controller.js';

const router = express.Router();

router.get('/:quizId/eligibility', requireAuth, getQuizEligibility);
router.post('/:quizId/attempts', requireAuth, startQuizAttempt);

export default router;
