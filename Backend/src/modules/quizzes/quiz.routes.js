import express from 'express';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import {
  requireQuizAccess,
  requireQuizChildAccess,
} from '../authorization/resource-authorization.js';
import * as quizController from './quiz.controller.js';

const router = express.Router();

const requireQuizManagement = requireQuizAccess({
  ownPermission: Permissions.QUIZZES_MANAGE_OWN,
  anyPermission: Permissions.QUIZZES_MANAGE_ANY,
});
const requireQuestionManagement = requireQuizChildAccess({
  childType: 'question',
  idParameter: 'questionId',
  ownPermission: Permissions.QUIZZES_MANAGE_OWN,
  anyPermission: Permissions.QUIZZES_MANAGE_ANY,
});
const requireRuleManagement = requireQuizChildAccess({
  childType: 'rule',
  idParameter: 'ruleId',
  ownPermission: Permissions.QUIZZES_MANAGE_OWN,
  anyPermission: Permissions.QUIZZES_MANAGE_ANY,
});
const requireQuestionSourceManagement = requireQuizChildAccess({
  childType: 'questionSource',
  idParameter: 'sourceId',
  ownPermission: Permissions.QUIZZES_MANAGE_OWN,
  anyPermission: Permissions.QUIZZES_MANAGE_ANY,
});

router.post('/create', requireAuth, requirePermission(Permissions.QUIZZES_CREATE), quizController.createQuiz);
router.patch('/:quizId', requireAuth, requireQuizManagement, quizController.updateQuiz);
router.delete('/:quizId', requireAuth, requireQuizManagement, quizController.deleteQuiz);
router.get('/user', requireAuth, requirePermission(Permissions.QUIZZES_MANAGE_OWN), quizController.getUserQuizzes);
router.get('/certificates', requireAuth, requirePermission(Permissions.QUIZZES_CERTIFICATES), quizController.getUserCertificates);
router.post('/certificate/generate', requireAuth, requirePermission(Permissions.QUIZZES_CERTIFICATES), quizController.generateCertificate);
router.get('/:quizId/details', optionalAuth, quizController.getVideoQuiz);
router.get('/:quizId/requirements/videos', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), quizController.getQuizRequirementVideos);
router.get('/:quizId/requirements', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), quizController.checkQuizRequirements);
router.get('/:quizId/questions', requireAuth, requireQuizManagement, quizController.getAllQuizQuestions);
router.get('/:quizId/rules', requireAuth, requireQuizManagement, quizController.getQuizAccessRules);

router.post('/:quizId/question/create', requireAuth, requireQuizManagement, quizController.createQuizQuestion);
router.delete('/question/:questionId', requireAuth, requireQuestionManagement, quizController.deleteQuizQuestion);
router.patch('/question/:questionId', requireAuth, requireQuestionManagement, quizController.updateQuizQuestion);

router.post('/:quizId/rule/create', requireAuth, requireQuizManagement, quizController.createQuizAccessRule);
router.patch('/rule/:ruleId', requireAuth, requireRuleManagement, quizController.updateQuizAccessRule);
router.delete('/rule/:ruleId', requireAuth, requireRuleManagement, quizController.deleteQuizAccessRule);

router.get('/:quizId/question-sources', requireAuth, requireQuizManagement, quizController.getQuizQuestionSources);
router.post('/:quizId/question-source/create', requireAuth, requireQuizManagement, quizController.createQuizQuestionSource);
router.patch('/question-source/:sourceId', requireAuth, requireQuestionSourceManagement, quizController.updateQuizQuestionSource);
router.delete('/question-source/:sourceId', requireAuth, requireQuestionSourceManagement, quizController.deleteQuizQuestionSource);



router.post('/:quizId/attempt/start', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), quizController.startQuizAttempt);
router.get('/:quizId/attempts', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), quizController.getUserQuizAttempts);
router.get('/attempt/:attemptId/questions', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), quizController.getAttemptQuestions);
router.post('/attempt/:attemptId/submit', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), quizController.submitQuizAttempt);
router.put('/attempt/:attemptId/question/:questionId/answer', requireAuth, requirePermission(Permissions.QUIZZES_PARTICIPATE), quizController.saveAttemptAnswer);



export default router;
