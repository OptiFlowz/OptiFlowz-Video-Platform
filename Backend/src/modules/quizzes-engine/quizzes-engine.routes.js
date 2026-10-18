import express from 'express';
import questionsRoutes from './questions/questions.routes.js';
import questionGroupsRoutes from './question-groups/question-groups.routes.js';
import quizzesRoutes from './quizzes/quizzes.routes.js';
import quizRequirementsRoutes from './quiz-requirements/quiz-requirements.routes.js';
import quizAttemptsRoutes from './quiz-attempts/quiz-attempts.routes.js';
import quizQuestionsRoutes from './quiz-questions/quiz-questions.routes.js';

const router = express.Router();

router.use('/questions', questionsRoutes);
router.use('/question-groups', questionGroupsRoutes);
router.use('/quiz-requirements', quizRequirementsRoutes);
router.use('/:quizId/questions', quizQuestionsRoutes);
router.use('/', quizAttemptsRoutes);
// Keep the root quiz resource after the more specific submodule routes.
router.use('/', quizzesRoutes);

export default router;
