import { sendSuccess, sendError } from '../../common/response.js';
import { getCertificatesInternal } from './handlers/getCertificates.js';
import { getCertificateInternal } from './handlers/getCertificate.js';
import { getCertificatePdfInternal } from './handlers/getCertificatePdf.js';

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
  try { return sendSuccess(res, { certificate: await getCertificateInternal(req.params) }); }
  catch (error) { return handleError(res, error); }
}

export async function getCertificatePdf(req, res) {
  const abortController = new AbortController();
  const onClose = () => { if (!res.writableEnded) abortController.abort(); };
  res.once('close', onClose);
  res.set('Cache-Control', 'no-store');
  try {
    const { pdf, filename } = await getCertificatePdfInternal(req.params, { signal: abortController.signal });
    if (res.destroyed) return;
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${filename}"`);
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(pdf);
  } catch (error) {
    if (res.destroyed) return;
    if (error.status === 503) res.set('Retry-After', '5');
    if (error.status === 503 || error.status === 504) return sendError(res, error.message, error.status);
    return handleError(res, error);
  } finally { res.off('close', onClose); }
}
