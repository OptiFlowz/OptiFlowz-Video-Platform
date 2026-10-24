import { HttpError } from '../../../common/httpError.js';

export const QR_CODE_KEY = 'certificate.qr_code_data_uri';
export const QR_PLACEHOLDER_SOURCE = String.raw`\{\{\s*certificate\.qr_code_data_uri(?:\.[a-z][a-z0-9_-]*)*\s*\}\}`;
export const isQrCodeKey = key => key === QR_CODE_KEY || key.startsWith(`${QR_CODE_KEY}.`);
export const qrStyleError = message => new HttpError(422, {
  message: `html_template: QR code: ${message}`, field: 'html_template',
});

const dotTypes = ['square', 'dots', 'rounded', 'extra-rounded', 'classy', 'classy-rounded'];
const cornerTypes = ['square', 'dot', 'dots', 'rounded', 'extra-rounded', 'classy', 'classy-rounded'];

function integer(value, min, max, name) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw qrStyleError(`${name} must be an integer from ${min} to ${max}`);
  }
  return Number(value);
}

function color(value) {
  if (!/^[a-f0-9]{6}$/i.test(value)) throw qrStyleError('Colors must contain six hexadecimal digits without #');
  return `#${value.toLowerCase()}`;
}

function choice(value, choices, name) {
  if (!choices.includes(value)) throw qrStyleError(`Unsupported ${name}; use ${choices.join(', ')}`);
  return value;
}

function gradient(value) {
  const [type, start, end, degrees = '0', ...extra] = value.split('_');
  if (extra.length) throw qrStyleError('Gradient syntax is linear|radial_starthex_endhex[_degrees]');
  return {
    type: choice(type, ['linear', 'radial'], 'gradient type'),
    rotation: integer(degrees, 0, 360, 'gradient rotation') * Math.PI / 180,
    colorStops: [{ offset: 0, color: color(start) }, { offset: 1, color: color(end) }],
  };
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => {
    const n = parseInt(value, 16) / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

// One allowlisted parser for CRUD validation, rendering, and future issuance.
// It never merges arbitrary user keys into library options.
export function parseCertificateQrOptions(key = QR_CODE_KEY) {
  if (!isQrCodeKey(key) || key.length > 1024) throw qrStyleError('Invalid placeholder or options exceed 1024 characters');
  const options = {
    width: 512, height: 512,
    qrOptions: { errorCorrectionLevel: 'Q', mode: 'Byte' },
    dotsOptions: { type: 'square', color: '#000000', roundSize: true },
    backgroundOptions: { color: '#ffffff' },
    cornersSquareOptions: { type: 'square' },
    cornersDotOptions: { type: 'square' },
  };
  let marginModules = 4;
  const seen = new Set();
  const parameters = key.slice(QR_CODE_KEY.length).split('.').slice(1);
  for (const parameter of parameters) {
    const separator = parameter.indexOf('_');
    if (separator < 1) throw qrStyleError('Each option must use name_value');
    const name = parameter.slice(0, separator);
    const value = parameter.slice(separator + 1);
    if (seen.has(name)) throw qrStyleError(`Duplicate option "${name}"`);
    seen.add(name);
    switch (name) {
      case 'size': options.width = options.height = integer(value, 128, 1024, 'size'); break;
      case 'color': options.dotsOptions.color = color(value); break;
      case 'background': options.backgroundOptions.color = color(value); break;
      case 'dots': options.dotsOptions.type = choice(value, dotTypes, 'dots style'); break;
      case 'corners': options.cornersSquareOptions.type = choice(value, cornerTypes, 'corners style'); break;
      case 'cornerdots': options.cornersDotOptions.type = choice(value, cornerTypes, 'cornerdots style'); break;
      case 'cornercolor': options.cornersSquareOptions.color = color(value); break;
      case 'cornerdotcolor': options.cornersDotOptions.color = color(value); break;
      case 'gradient': options.dotsOptions.gradient = gradient(value); break;
      case 'backgroundgradient': options.backgroundOptions.gradient = gradient(value); break;
      case 'cornergradient': options.cornersSquareOptions.gradient = gradient(value); break;
      case 'cornerdotgradient': options.cornersDotOptions.gradient = gradient(value); break;
      case 'margin': marginModules = integer(value, 4, 16, 'margin (QR modules)'); break;
      case 'ecc': options.qrOptions.errorCorrectionLevel = choice(value.toUpperCase(), ['M', 'Q', 'H'], 'ecc'); break;
      default: throw qrStyleError(`Unknown option "${name}"`);
    }
  }
  for (const [solid, shaded] of [['color', 'gradient'], ['background', 'backgroundgradient'],
    ['cornercolor', 'cornergradient'], ['cornerdotcolor', 'cornerdotgradient']]) {
    if (seen.has(solid) && seen.has(shaded)) throw qrStyleError(`Use either ${solid} or ${shaded}`);
  }
  const palette = style => style.gradient ? style.gradient.colorStops.map(stop => stop.color) : [style.color];
  const background = Math.min(...palette(options.backgroundOptions).map(luminance));
  for (const style of [options.dotsOptions, options.cornersSquareOptions, options.cornersDotOptions]) {
    const colors = style.color || style.gradient ? palette(style) : palette(options.dotsOptions);
    if (colors.some(hex => (background + 0.05) / (luminance(hex) + 0.05) < 2)) {
      throw qrStyleError('QR dots and corners must be darker than the background with contrast of at least 2:1');
    }
  }
  return { options, marginModules };
}

export function isQrCodePlaceholder(value) {
  if (value !== value.trim() || !new RegExp(`^(?:${QR_PLACEHOLDER_SOURCE})$`, 'i').test(value)) return false;
  parseCertificateQrOptions(value.slice(2, -2).trim());
  return true;
}
