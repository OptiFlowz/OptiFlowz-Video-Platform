import { requireQuizResourceAccess as access } from '../helpers/quizAuthorization.js';
import { requirePermission } from '../../authorization/authorization.middleware.js';
import { Permissions } from '../../authorization/permission.constants.js';
import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as questionsController from './questions.controller.js';

const router = express.Router();

router.use(requireAuth);
router.post('/', requirePermission(Permissions.QUESTIONS_CREATE), questionsController.createQuestion);
router.get('/', access('questions', 'read', { list: true }), questionsController.getQuestions);
router.get('/:questionId', access('questions', 'read', { key: 'questionId' }), questionsController.getQuestion);
router.patch('/:questionId', access('questions', 'update', { key: 'questionId' }), questionsController.updateQuestion);
router.delete('/:questionId', access('questions', 'delete', { key: 'questionId' }), questionsController.deleteQuestion);

export default router;
