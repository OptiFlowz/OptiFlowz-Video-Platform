import { getCertificateInternal } from './getCertificate.js';
import { buildCertificateDocument } from '../certificate-templates/helpers/previewDocument.js';
import { renderCertificatePdf } from '../certificate-templates/services/renderCertificatePdf.js';
import { fillCertificateQrCode, getCertificateVerificationUrl } from '../helpers/certificateQrCode.js';
import { QR_PLACEHOLDER_SOURCE } from '../helpers/certificateQrOptions.js';
import { HttpError } from '../../../common/httpError.js';

export async function getCertificatePdfInternal(params, options) {
  const certificate = await getCertificateInternal(params);
  if (certificate.status === 'revoked') {
    throw new HttpError(403, { message: 'Revoked certificates cannot be downloaded' });
  }
  const snapshot = certificate.data_snapshot;
  const issuedAt = new Date(certificate.issued_at);
  if (!certificate.template_snapshot || !snapshot || !Number.isFinite(issuedAt.getTime())) {
    throw new HttpError(422, { message: 'Invalid certificate snapshot' });
  }
  const values = {
    'user.full_name': snapshot.user?.full_name,
    'quiz.title': snapshot.quiz?.title,
    'result.score_percentage': snapshot.result?.score_percentage,
    'result.earned_points': snapshot.result?.earned_points,
    'result.max_points': snapshot.result?.max_points,
    'certificate.number': certificate.certificate_number,
    'certificate.issued_at': issuedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
  };
  const document = buildCertificateDocument(certificate.template_snapshot, values);
  if (new RegExp(QR_PLACEHOLDER_SOURCE, 'i').test(document.html)) {
    document.html = await fillCertificateQrCode(document.html, getCertificateVerificationUrl(certificate.id));
  }
  const pdf = await renderCertificatePdf(document, options);
  return { pdf, filename: `certificate-${certificate.id}.pdf` };
}
