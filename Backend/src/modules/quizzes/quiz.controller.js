import { sendSuccess, sendError } from '../../common/response.js';

import { createQuizInternal } from './handlers/createQuiz.js';
import { updateQuizInternal } from './handlers/updateQuiz.js';
import { deleteQuizInternal } from './handlers/deleteQuiz.js';
import { getUserQuizzesInternal } from './handlers/getUserQuizzes.js';

import { createQuizQuestionInternal } from './handlers/createQuizQuestion.js';
import { deleteQuizQuestionInternal } from './handlers/deleteQuizQuestion.js';
import { updateQuizQuestionInternal } from './handlers/updateQuizQuestion.js';
import { getAllQuizQuestionsInternal } from './handlers/getAllQuizQuestions.js';
import { getVideoQuizInternal } from './handlers/getVideoQuiz.js';

import { createQuizAccessRuleInternal } from './handlers/createQuizAccessRule.js';
import { updateQuizAccessRuleInternal } from './handlers/updateQuizAccessRule.js';
import { deleteQuizAccessRuleInternal } from './handlers/deleteQuizAccessRule.js';
import { getQuizAccessRulesInternal } from './handlers/getQuizAccessRules.js';
import { checkQuizRequirementsInternal } from './handlers/checkQuizRequirements.js';
import { getQuizRequirementVideosInternal } from './handlers/getQuizRequirementVideos.js';

import { createQuizQuestionSourceInternal } from './handlers/createQuizQuestionSource.js';
import { updateQuizQuestionSourceInternal } from './handlers/updateQuizQuestionSource.js';
import { deleteQuizQuestionSourceInternal } from './handlers/deleteQuizQuestionSource.js';
import { getQuizQuestionSourcesInternal } from './handlers/getQuizQuestionSources.js';

// import { getUserQuizAttemptsInternal } from './handlers/getUserQuizAttempts.js';
// import { startQuizAttemptInternal } from './handlers/startQuizAttempt.js';
// import { saveQuizAttemptAnswerInternal } from './handlers/saveAttemptAnswer.js';



export async function createQuiz(req, res) {
  try {
    const quiz = await createQuizInternal({ ...req.params, ...req.body }, req.user?.sub || null);
    return sendSuccess(res, { quiz }, 201);
  } catch (error) {
    console.error('Error creating video quiz:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function updateQuiz(req, res) {
  try {
    const quiz = await updateQuizInternal({ ...req.params, ...req.body }, req.user?.sub || null);

    if (!quiz) {
      return sendError(res, 'Quiz not found', 404);
    }

    return sendSuccess(res, { quiz });
  } catch (error) {
    console.error('Error updating video quiz:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deleteQuiz(req, res) {
  try {
    const deleted = await deleteQuizInternal(req.params, req.user?.sub || null);

    if (!deleted) {
      return sendError(res, 'Quiz not found', 404);
    }

    return sendSuccess(res, { deleted: true });
  } catch (error) {
    console.error('Error deleting video quiz:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getUserQuizzes(req, res) {
  try {
    const quizzes = await getUserQuizzesInternal({ ...req.params, ...req.query },req.user?.sub || null);

    if (!quizzes) {
      return sendError(res, 'Quiz not found', 404);
    }

    return sendSuccess(res, { quizzes });
  } catch (error) {
    console.error('Error fetching video quiz:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getVideoQuiz(req, res) {
  try {
    const quiz = await getVideoQuizInternal({ ...req.params},  req.user?.sub || null);

    if (!quiz) {
      return sendError(res, 'Quiz not found', 404);
    }

    return sendSuccess(res, { quiz });
  } catch (error) {
    console.error('Error fetching video quiz:', error);
    return sendError(res, error.message, error.status || 500);
  }
}




export async function createQuizQuestion(req, res) {
  try {
    const question = await createQuizQuestionInternal({ ...req.params, ...req.body }, req.user?.sub || null);
    return sendSuccess(res, { question }, 201);
  } catch (error) {
    console.error('Error creating quiz question:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deleteQuizQuestion(req, res) {
  try {
    const deleted = await deleteQuizQuestionInternal(req.params, req.user?.sub || null);

    if (!deleted) {
      return sendError(res, 'Question not found', 404);
    }

    return sendSuccess(res, { deleted: true });
  } catch (error) {
    console.error('Error deleting quiz question:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function updateQuizQuestion(req, res) {
  try {
    const question = await updateQuizQuestionInternal({ ...req.params, ...req.body }, req.user?.sub || null);

    if (!question) {
      return sendError(res, 'Question not found', 404);
    }

    return sendSuccess(res, { question });
  } catch (error) {
    console.error('Error updating quiz question:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getAllQuizQuestions(req, res) {
  try {
    const result = await getAllQuizQuestionsInternal({ ...req.params, ...req.query },req.user?.sub || null);

    return sendSuccess(res, result);
  } catch (error) {
    console.error('Error getting quiz questions:', error);
    return sendError(res, error.message, error.status || 500);
  }
}




export async function createQuizAccessRule(req, res) {
  try {
    const rule = await createQuizAccessRuleInternal({ ...req.params, ...req.body }, req.user?.sub || null);
    return sendSuccess(res, { rule }, 201);
  } catch (error) {
    console.error('Error creating quiz access rule:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function updateQuizAccessRule(req, res) {
  try {
    const rule = await updateQuizAccessRuleInternal({ ...req.params, ...req.body }, req.user?.sub || null);
    return sendSuccess(res, { rule }, 200);
  } catch (error) {
    console.error('Error updating quiz access rule:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deleteQuizAccessRule(req, res) {
  try {
    await deleteQuizAccessRuleInternal(req.params.ruleId, req.user?.sub || null);
    return sendSuccess(res, { message: 'Quiz access rule deleted successfully.' }, 200);
  } catch (error) {
    console.error('Error deleting quiz access rule:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getQuizAccessRules(req, res) {
  try {
    const rules = await getQuizAccessRulesInternal(req.params.quizId, req.user?.sub || null);
    return sendSuccess(res, { rules }, 200);
  } catch (error) {
    console.error('Error fetching quiz access rules:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function checkQuizRequirements(req, res) {
  try {
    const hasMetRequirements = await checkQuizRequirementsInternal(req.params, req.user?.sub || null);
    return sendSuccess(res, { hasMetRequirements }, 200);
  } catch (error) {
    console.error('Error checking quiz requirements:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getQuizRequirementVideos(req, res) {
  try {
    const requirements = await getQuizRequirementVideosInternal(req.params, req.user?.sub || null);
    return sendSuccess(res, { requirements }, 200);
  } catch (error) {
    console.error('Error fetching quiz requirement videos:', error);
    return sendError(res, error.message, error.status || 500);
  }
}



export async function createQuizQuestionSource(req, res) {
  try {
    const source = await createQuizQuestionSourceInternal(
      { ...req.params, ...req.body },
      req.user?.sub || null
    );

    return sendSuccess(res, { source }, 201);
  } catch (error) {
    console.error('Error creating quiz question source:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function updateQuizQuestionSource(req, res) {
  try {
    const source = await updateQuizQuestionSourceInternal(
      { ...req.params, ...req.body },
      req.user?.sub || null
    );

    return sendSuccess(res, { source }, 200);
  } catch (error) {
    console.error('Error updating quiz question source:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deleteQuizQuestionSource(req, res) {
  try {
    const deleted = await deleteQuizQuestionSourceInternal(
      { ...req.params },
      req.user?.sub || null
    );

    return sendSuccess(res, { deleted }, 200);
  } catch (error) {
    console.error('Error deleting quiz question source:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getQuizQuestionSources(req, res) {
  try {
    const sources = await getQuizQuestionSourcesInternal(
      { ...req.params },
      req.user?.sub || null
    );

    return sendSuccess(res, { sources }, 200);
  } catch (error) {
    console.error('Error fetching quiz question sources:', error);
    return sendError(res, error.message, error.status || 500);
  }
}
