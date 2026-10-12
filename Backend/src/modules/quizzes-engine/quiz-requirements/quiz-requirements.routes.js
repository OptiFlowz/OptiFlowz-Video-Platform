import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as controller from './quiz-requirements.controller.js';

const router = express.Router();

router.use(requireAuth);
router.post('/', controller.createQuizRequirement);
router.get('/', controller.getQuizRequirements);
router.get('/:quizId/:videoId', controller.getQuizRequirement);
router.patch('/:quizId/:videoId', controller.updateQuizRequirement);
router.delete('/:quizId/:videoId', controller.deleteQuizRequirement);

export default router;
