import { getCertificateTemplateInternal } from './getCertificateTemplate.js';
import { buildPreviewDocument } from '../helpers/previewDocument.js';
import { renderCertificatePdf } from '../services/renderCertificatePdf.js';
import { fillCertificateQrCode } from '../../helpers/certificateQrCode.js';

export async function previewCertificateTemplatePdfInternal(params, userId, options) {
  // Reuse the details lookup: the user's own private templates and all system templates.
  const template = await getCertificateTemplateInternal(params, userId);
  const document = buildPreviewDocument(template);
  document.html = await fillCertificateQrCode(document.html);
  const pdf = await renderCertificatePdf(document, options);
  return { pdf, filename: `certificate-preview-${template.id}.pdf` };
}
