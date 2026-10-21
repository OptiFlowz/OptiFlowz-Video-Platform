import { sendSuccess, sendError } from '../../../common/response.js';
import { createQuestionInternal } from './handlers/createQuestion.js';
import { getQuestionsInternal } from './handlers/getQuestions.js';
import { getQuestionInternal } from './handlers/getQuestion.js';
import { updateQuestionInternal } from './handlers/updateQuestion.js';
import { deleteQuestionInternal } from './handlers/deleteQuestion.js';
import { importQuestionsInternal } from './handlers/importQuestions.js';
import { exportQuestionsInternal } from './handlers/exportQuestions.js';
import { hasPermission } from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';

function handleQuestionError(res, error, action) {
  if (!error.status || error.status >= 500) console.error(`${action} error:`, error);
  return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to process the question request', error.status || 500);
}

export async function createQuestion(req, res) {
  try {
    const question = await createQuestionInternal(req.body, req.user?.sub);
    return sendSuccess(res, { question }, 201);
  } catch (error) { return handleQuestionError(res, error, 'createQuestion'); }
}

export async function getQuestions(req, res) {
  try {
    return sendSuccess(res, await getQuestionsInternal(req.query, req.resourceOwnerId ?? req.user?.sub, req.resourceAccess));
  } catch (error) { return handleQuestionError(res, error, 'getQuestions'); }
}

export async function getQuestion(req, res) {
  try {
    const question = await getQuestionInternal(req.params, req.resourceOwnerId ?? req.user?.sub);
    return sendSuccess(res, { question });
  } catch (error) { return handleQuestionError(res, error, 'getQuestion'); }
}

export async function updateQuestion(req, res) {
  try {
    const question = await updateQuestionInternal(req.params, req.body, req.resourceOwnerId ?? req.user?.sub);
    return sendSuccess(res, { question });
  } catch (error) { return handleQuestionError(res, error, 'updateQuestion'); }
}

export async function deleteQuestion(req, res) {
  try {
    return sendSuccess(res, await deleteQuestionInternal(req.params, req.resourceOwnerId ?? req.user?.sub));
  } catch (error) { return handleQuestionError(res, error, 'deleteQuestion'); }
}

function transferError(res, error) {
  if (!error.status || error.status >= 500) console.error('Question transfer error:', error);
  return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to transfer questions', error.status || 500);
}

export async function importQuestions(req, res) {
  try {
    const buffer = req.file?.buffer ?? req.body;
    if (!Buffer.isBuffer(buffer) || !buffer.length) return sendError(res, 'Provide one XML file in the file field or an XML request body', 400);
    let xml;
    try { xml = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { return sendError(res, 'The XML file must use UTF-8', 400); }
    const result = await importQuestionsInternal(xml, req.query, req.user.sub, {
      canCreateCategories: hasPermission(req.authorization, Permissions.QUESTION_CATEGORIES_CREATE),
    });
    return sendSuccess(res, result, 201);
  } catch (error) { return transferError(res, error); }
}

export async function exportQuestions(req, res) {
  try {
    const xml = await exportQuestionsInternal(req.query, req.user.sub);
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.type('application/xml').attachment('questions-moodle.xml').send(xml);
  } catch (error) { return transferError(res, error); }
}
