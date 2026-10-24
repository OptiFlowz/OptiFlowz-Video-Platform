import QRCode from 'qrcode';
import { HttpError } from '../../../common/httpError.js';

const qrPlaceholder = /\{\{\s*certificate\.qr_code_data_uri\s*\}\}/g;

// Shared by preview and future certificate issuance; no network or database access.
export async function generateCertificateQrCode(verificationUrl) {
  return QRCode.toDataURL(verificationUrl, {
    type: 'image/png', errorCorrectionLevel: 'M', margin: 4, width: 512,
  });
}

export function getPreviewVerificationUrl(baseUrl = process.env.FRONTEND_BASE_URL) {
  let url;
  try { url = new URL(baseUrl); } catch { /* Report a configuration error below. */ }
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new HttpError(500, { message: 'FRONTEND_BASE_URL must be an absolute HTTP(S) URL for certificate QR preview' });
  }
  // A dedicated test identifier, never an issued certificate's verification token.
  url.pathname = `${url.pathname.replace(/\/$/, '')}/certificates/verify/preview`;
  url.search = '';
  url.hash = '';
  return url.href;
}

// Only call after template validation/normalization has restricted the placeholder to img src.
// Replace in the render copy, retaining the original template source in storage.
export async function fillCertificateQrCode(html, verificationUrl) {
  if (!html.match(qrPlaceholder)) return html;
  const dataUri = await generateCertificateQrCode(verificationUrl ?? getPreviewVerificationUrl());
  return html.replace(qrPlaceholder, () => dataUri);
}
