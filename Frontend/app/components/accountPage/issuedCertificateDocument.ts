import { certificateQrImages } from '../quizEngine/certificateQrStyles';
import { certificateHtmlDocument } from '../quizEngine/certificatePreview';
import type { CertificateDetail } from './accountQueries';

/** Both the visible preview and PDF use the immutable issued snapshot. */
export async function issuedCertificateDocument(certificate: CertificateDetail): Promise<string> {
  const template = certificate.template_snapshot;
  const verificationUrl = new URL(`certificates/verify/${encodeURIComponent(certificate.id)}`, `${window.location.origin}/`).href;
  const qrImages = await certificateQrImages(template.html_template, verificationUrl);
  const data = certificate.data_snapshot;
  return certificateHtmlDocument(template, qrImages, { sampleQr: false, values: {
    'user.full_name': data.user.full_name,
    'quiz.title': data.quiz.title,
    'result.score_percentage': String(data.result.score_percentage),
    'result.earned_points': String(data.result.earned_points),
    'result.max_points': String(data.result.max_points),
    'certificate.number': certificate.certificate_number,
    'certificate.issued_at': new Date(certificate.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
  } });
}
