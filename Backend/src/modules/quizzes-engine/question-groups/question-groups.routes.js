import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as questionGroupsController from './question-groups.controller.js';

const router = express.Router();

router.use(requireAuth);
router.post('/', questionGroupsController.createQuestionGroup);
router.get('/', questionGroupsController.getQuestionGroups);
router.get('/:groupId', questionGroupsController.getQuestionGroup);
router.patch('/:groupId', questionGroupsController.updateQuestionGroup);
router.put('/:groupId/questions', questionGroupsController.syncQuestionGroupQuestions);
router.delete('/:groupId', questionGroupsController.deleteQuestionGroup);

export default router;
