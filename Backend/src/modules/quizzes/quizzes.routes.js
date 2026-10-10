import express from 'express';
import questionsRoutes from './questions/questions.routes.js';
import questionGroupsRoutes from './question-groups/question-groups.routes.js';

const router = express.Router();

router.use('/questions', questionsRoutes);
router.use('/question-groups', questionGroupsRoutes);

export default router;
