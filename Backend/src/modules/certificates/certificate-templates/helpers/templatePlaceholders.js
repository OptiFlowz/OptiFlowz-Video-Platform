import { HttpError } from '../../../../common/httpError.js';
import { isQrCodeKey, parseCertificateQrOptions } from '../../helpers/certificateQrOptions.js';
export { isQrCodePlaceholder } from '../../helpers/certificateQrOptions.js';

export const PREVIEW_DATA = Object.freeze({
  'user.full_name': 'John Anderson',
  'quiz.title': 'Workplace Health and Safety Fundamentals',
  'result.score_percentage': 95,
  'result.earned_points': 19,
  'result.max_points': 20,
  'certificate.number': 'CERT-2026-000001',
  'certificate.issued_at': 'October 23, 2026',
});

const placeholderPattern = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*)*)\s*\}\}/gi;

function invalid(message, field = 'html_template') {
  throw new HttpError(422, { message: `${field}: ${message}`, field });
}

export function validatePlaceholders(source, field = 'html_template', allowQrSource = false) {
  if (field === 'css_template') {
    if (/\{\{/.test(source)) invalid('Placeholders are only allowed in HTML text', field);
    // Adjacent closing braces are normal in compact nested CSS, not placeholder delimiters.
    return;
  }
  if (/\{\{\{|\}\}\}/.test(source)) invalid('Triple-brace placeholders are not allowed', field);
  const remaining = source.replace(placeholderPattern, (_match, key) => {
    if (isQrCodeKey(key)) {
      if (!allowQrSource) invalid('QR code placeholder is only allowed as the entire src of an HTML img element', field);
      parseCertificateQrOptions(key);
      return '';
    }
    if (!Object.hasOwn(PREVIEW_DATA, key)) invalid(`Unknown placeholder "${key}"`, field);
    return '';
  });
  if (/\{\{|\}\}/.test(remaining)) invalid('Malformed placeholder; use {{name}} with an allowed name', field);
}

export function rejectAttributePlaceholders(value) {
  if (/\{\{|\}\}/.test(value)) invalid('Placeholders are only allowed in HTML text, not attributes');
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function fillPreviewPlaceholders(html) {
  // The caller has already validated each placeholder's HTML context.
  validatePlaceholders(html, 'html_template', true);
  return html.replace(placeholderPattern, (match, key) => isQrCodeKey(key) ? match : escapeHtml(PREVIEW_DATA[key]));
}
