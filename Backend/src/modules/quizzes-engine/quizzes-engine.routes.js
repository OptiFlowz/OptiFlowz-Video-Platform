import express from 'express';
import questionsRoutes from './questions/questions.routes.js';
import questionGroupsRoutes from './question-groups/question-groups.routes.js';
import quizzesRoutes from './quizzes/quizzes.routes.js';

const router = express.Router();

router.use('/questions', questionsRoutes);
router.use('/question-groups', questionGroupsRoutes);
// Keep the root quiz resource after the more specific submodule routes.
router.use('/', quizzesRoutes);

export default router;
