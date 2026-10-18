import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as controller from './quiz-sources.controller.js';

const router = express.Router({ mergeParams: true });

router.use(requireAuth);
router.post('/', controller.createQuizSource);
router.put('/', controller.replaceQuizSources);
router.get('/', controller.getQuizSources);
router.get('/:groupId', controller.getQuizSource);
router.patch('/:groupId', controller.updateQuizSource);
router.delete('/:groupId', controller.deleteQuizSource);

export default router;
