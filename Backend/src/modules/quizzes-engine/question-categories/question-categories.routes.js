import { requireQuizResourceAccess as access } from '../helpers/quizAuthorization.js';
import { requirePermission } from '../../authorization/authorization.middleware.js';
import { Permissions } from '../../authorization/permission.constants.js';
import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as questionCategoriesController from './question-categories.controller.js';

const router = express.Router();

router.use(requireAuth);
router.post('/', requirePermission(Permissions.QUESTION_CATEGORIES_CREATE), questionCategoriesController.createQuestionCategory);
router.get('/', access('categories', 'read', { list: true }), questionCategoriesController.getQuestionCategories);
router.get('/:categoryId', access('categories', 'read', { key: 'categoryId' }), questionCategoriesController.getQuestionCategory);
router.patch('/:categoryId', access('categories', 'update', { key: 'categoryId' }), questionCategoriesController.updateQuestionCategory);
router.put('/:categoryId/questions', access('categories', 'update', { key: 'categoryId' }), questionCategoriesController.syncQuestionCategoryQuestions);
router.delete('/:categoryId', access('categories', 'delete', { key: 'categoryId' }), questionCategoriesController.deleteQuestionCategory);

export default router;
