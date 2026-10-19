import { requireQuizResourceAccess as access } from '../helpers/quizAuthorization.js';
import { requirePermission } from '../../authorization/authorization.middleware.js';
import { Permissions } from '../../authorization/permission.constants.js';
import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as questionGroupsController from './question-groups.controller.js';

const router = express.Router();

router.use(requireAuth);
router.post('/', requirePermission(Permissions.QUESTION_GROUPS_CREATE), questionGroupsController.createQuestionGroup);
router.get('/', access('groups', 'read', { list: true }), questionGroupsController.getQuestionGroups);
router.get('/:groupId', access('groups', 'read', { key: 'groupId' }), questionGroupsController.getQuestionGroup);
router.patch('/:groupId', access('groups', 'update', { key: 'groupId' }), questionGroupsController.updateQuestionGroup);
router.put('/:groupId/questions', access('groups', 'update', { key: 'groupId' }), questionGroupsController.syncQuestionGroupQuestions);
router.delete('/:groupId', access('groups', 'delete', { key: 'groupId' }), questionGroupsController.deleteQuestionGroup);

export default router;
