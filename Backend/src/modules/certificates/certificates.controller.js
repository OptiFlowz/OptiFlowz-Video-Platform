import { sendSuccess, sendError } from '../../common/response.js';
import { getCertificatesInternal } from './handlers/getCertificates.js';
import { getCertificateInternal } from './handlers/getCertificate.js';

function handleError(res, error) {
  if (!error.status || error.status >= 500) console.error('Certificate read error:', error);
  return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to get certificates', error.status || 500);
}

export async function getCertificates(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try { return sendSuccess(res, await getCertificatesInternal(req.query, req.user?.sub)); }
  catch (error) { return handleError(res, error); }
}

export async function getCertificate(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try { return sendSuccess(res, { certificate: await getCertificateInternal(req.params, req.user?.sub) }); }
  catch (error) { return handleError(res, error); }
}
