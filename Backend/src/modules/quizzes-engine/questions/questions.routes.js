import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as questionsController from './questions.controller.js';

const router = express.Router();

router.use(requireAuth);
router.post('/', questionsController.createQuestion);
router.get('/', questionsController.getQuestions);
router.get('/:questionId', questionsController.getQuestion);
router.patch('/:questionId', questionsController.updateQuestion);
router.delete('/:questionId', questionsController.deleteQuestion);

export default router;
