import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import { getQuizEligibility } from './quiz-attempts.controller.js';

const router = express.Router();

router.get('/:quizId/eligibility', requireAuth, getQuizEligibility);

export default router;
