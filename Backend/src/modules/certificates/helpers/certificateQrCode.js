import QRCodeStyling from 'qr-code-styling';
import qrcode from 'qrcode-generator';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { HttpError } from '../../../common/httpError.js';
import { QR_CODE_KEY, QR_PLACEHOLDER_SOURCE, parseCertificateQrOptions, qrStyleError } from './certificateQrOptions.js';

const qrPlaceholder = new RegExp(QR_PLACEHOLDER_SOURCE, 'gi');
const MAX_RENDER_BYTES = 3 * 1024 * 1024;

// Shared by preview and future certificate issuance; no network or database access.
export async function generateCertificateQrCode(verificationUrl, key = QR_CODE_KEY) {
  const { options, marginModules } = parseCertificateQrOptions(key);
  if (typeof verificationUrl !== 'string' || !verificationUrl || Buffer.byteLength(verificationUrl) > 1024) {
    throw qrStyleError('Verification URL must contain 1–1024 bytes');
  }
  // Use the same encoder as qr-code-styling to size the four-module quiet zone.
  const matrix = qrcode(0, options.qrOptions.errorCorrectionLevel);
  matrix.addData(verificationUrl, options.qrOptions.mode);
  matrix.make();
  const modules = matrix.getModuleCount();
  const modulePixels = Math.floor(options.width / (modules + 2 * marginModules));
  if (modulePixels < 3) throw qrStyleError('Size is too small for this URL and margin; increase size');
  options.margin = marginModules * modulePixels;

  const windows = [];
  class RenderDom extends JSDOM {
    constructor(...args) { super(...args); windows.push(this.window); }
  }
  try {
    const qr = new QRCodeStyling({ ...options, data: verificationUrl, type: 'svg', jsdom: RenderDom });
    const svg = await qr.getRawData('svg');
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: 'dontInvert' });
    if (decoded?.data !== verificationUrl) {
      throw qrStyleError('This style cannot be reliably decoded; increase size or use simpler dots/corners and stronger contrast');
    }
    return `data:image/png;base64,${png.toString('base64')}`;
  } finally {
    for (const window of windows) window.close();
  }
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
  const matches = [...html.matchAll(qrPlaceholder)];
  if (!matches.length) return html;
  const styles = new Map();
  for (const [placeholder] of matches) {
    const key = placeholder.slice(2, -2).trim();
    const parsed = parseCertificateQrOptions(key);
    const cacheKey = JSON.stringify(parsed);
    if (!styles.has(cacheKey)) styles.set(cacheKey, { key });
  }
  if (styles.size > 8) throw qrStyleError('At most eight distinct QR styles are allowed per render');
  const url = verificationUrl ?? getPreviewVerificationUrl();
  for (const entry of styles.values()) entry.dataUri = await generateCertificateQrCode(url, entry.key);
  let bytes = Buffer.byteLength(html);
  const replacements = new Map();
  for (const [placeholder] of matches) {
    const cacheKey = JSON.stringify(parseCertificateQrOptions(placeholder.slice(2, -2).trim()));
    const { dataUri } = styles.get(cacheKey);
    bytes += Buffer.byteLength(dataUri) - Buffer.byteLength(placeholder);
    if (bytes > MAX_RENDER_BYTES) throw qrStyleError('Generated document exceeds the 3 MiB limit');
    replacements.set(placeholder, dataUri);
  }
  return html.replace(qrPlaceholder, match => replacements.get(match));
}
