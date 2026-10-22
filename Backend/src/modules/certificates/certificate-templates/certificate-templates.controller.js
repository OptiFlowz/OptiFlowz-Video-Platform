import { sendSuccess, sendError } from '../../../common/response.js';
import { createCertificateTemplateInternal } from './handlers/createCertificateTemplate.js';
import { getCertificateTemplatesInternal } from './handlers/getCertificateTemplates.js';
import { getCertificateTemplateInternal } from './handlers/getCertificateTemplate.js';
import { updateCertificateTemplateInternal } from './handlers/updateCertificateTemplate.js';
import { deleteCertificateTemplateInternal } from './handlers/deleteCertificateTemplate.js';

function handleTemplateError(res, error, action) {
  if (!error.status || error.status >= 500) console.error(`${action} error:`, error);
  return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to process the certificate template request',
    error.status || 500, error.status === 422 ? { field: error.body?.field } : {});
}

export async function createCertificateTemplate(req, res) {
  try {
    const template = await createCertificateTemplateInternal(req.body, req.user?.sub);
    return sendSuccess(res, { template }, 201);
  } catch (error) { return handleTemplateError(res, error, 'createCertificateTemplate'); }
}

export async function getCertificateTemplates(req, res) {
  try {
    return sendSuccess(res, await getCertificateTemplatesInternal(req.query, req.user?.sub));
  } catch (error) { return handleTemplateError(res, error, 'getCertificateTemplates'); }
}

export async function getCertificateTemplate(req, res) {
  try {
    const template = await getCertificateTemplateInternal(req.params, req.user?.sub);
    return sendSuccess(res, { template });
  } catch (error) { return handleTemplateError(res, error, 'getCertificateTemplate'); }
}

export async function updateCertificateTemplate(req, res) {
  try {
    const template = await updateCertificateTemplateInternal(req.params, req.body, req.user?.sub);
    return sendSuccess(res, { template });
  } catch (error) { return handleTemplateError(res, error, 'updateCertificateTemplate'); }
}

export async function deleteCertificateTemplate(req, res) {
  try {
    return sendSuccess(res, await deleteCertificateTemplateInternal(req.params, req.user?.sub));
  } catch (error) { return handleTemplateError(res, error, 'deleteCertificateTemplate'); }
}
