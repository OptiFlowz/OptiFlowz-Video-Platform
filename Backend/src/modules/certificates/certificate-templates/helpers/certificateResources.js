import { HttpError } from '../../../../common/httpError.js';
import valueParser from 'postcss-value-parser';

export const FONT_ORIGIN = 'https://certificate-fonts.invalid';
export const RESOURCE_LIMITS = Object.freeze({ fonts: 32, stylesheets: 4, fontBytes: 1024 * 1024,
  stylesheetBytes: 64 * 1024, totalBytes: 4 * 1024 * 1024, timeoutMs: 5000 });

export function resourceError(message, field = 'css_template') {
  return new HttpError(422, { message: `${field}: ${message}`, field });
}

export function httpsResourceUrl(value, field = 'css_template') {
  if (!/^https:\/\//i.test(value) || /[\s\u0000-\u001f\u007f\\]/.test(value)) {
    throw resourceError('Resource URLs must be absolute HTTPS URLs', field);
  }
  let url;
  try { url = new URL(value); } catch { throw resourceError('Invalid resource URL', field); }
  if (!url.hostname || url.username || url.password) throw resourceError('URL credentials are not allowed', field);
  return url;
}

export function googleFontStylesheet(value, field = 'css_template') {
  const url = httpsResourceUrl(value, field);
  if (url.hostname !== 'fonts.googleapis.com' || url.port || !['/css', '/css2'].includes(url.pathname) || url.hash) {
    throw resourceError('Font stylesheets must use https://fonts.googleapis.com/css or /css2', field);
  }
  return url.href;
}

export function decodeCssEscapes(value) {
  return value.replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\r\n\f])/gi, (_, hex, character) => {
    if (!hex) return character;
    const code = parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
  });
}

export function fontImportUrl(params, field = 'css_template') {
  const nodes = valueParser(params).nodes.filter(node => !['space', 'comment'].includes(node.type));
  const node = nodes[0];
  let value;
  if (nodes.length === 1 && !node.unclosed) {
    if (node.type === 'string') value = node.value;
    if (node.type === 'function' && decodeCssEscapes(node.value).toLowerCase() === 'url') {
      const parts = node.nodes.filter(part => !['space', 'comment'].includes(part.type));
      if (parts.length === 1 && ['string', 'word'].includes(parts[0].type) && !parts[0].unclosed) value = parts[0].value;
    }
  }
  if (!value) throw resourceError('Use a single Google Fonts URL in @import', field);
  return googleFontStylesheet(decodeCssEscapes(value), field);
}

export function fontContentType(bytes) {
  if (bytes.length < 12) return null;
  const magic = bytes.subarray(0, 4).toString('latin1');
  return { wOFF: 'font/woff', wOF2: 'font/woff2', OTTO: 'font/otf', '\x00\x01\x00\x00': 'font/ttf' }[magic] || null;
}

export function decodeBase64(value, field) {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw resourceError('Invalid base64 resource', field);
  }
  return Buffer.from(value, 'base64');
}

export function validateEmbeddedFont(value, field) {
  const match = /^data:(font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-woff|x-font-ttf|x-font-opentype));base64,([\s\S]*)$/i.exec(value);
  if (!match) throw resourceError('Embedded fonts must be base64 WOFF, WOFF2, TTF or OTF', field);
  const bytes = decodeBase64(match[2], field);
  if (bytes.length > RESOURCE_LIMITS.fontBytes || !fontContentType(bytes)) throw resourceError('Invalid or oversized embedded font', field);
}

// Replace remote @font-face sources with browser-only URLs served by our bounded font loader.
export function rewriteFontSources(root, sources) {
  root.walkAtRules(rule => {
    if (rule.name.toLowerCase() !== 'font-face') return;
    rule.walkDecls(declaration => {
      if (decodeCssEscapes(declaration.prop).toLowerCase() !== 'src') return;
      const parsed = valueParser(declaration.value);
      parsed.walk(node => {
        if (node.type !== 'function' || decodeCssEscapes(node.value).toLowerCase() !== 'url') return;
        const part = node.nodes.find(item => !['space', 'comment'].includes(item.type));
        const value = decodeCssEscapes(part.value);
        if (/^data:/i.test(value)) return false;
        const url = httpsResourceUrl(value).href;
        let index = sources.indexOf(url);
        if (index === -1) {
          if (sources.length >= RESOURCE_LIMITS.fonts) throw resourceError('Too many font files');
          index = sources.push(url) - 1;
        }
        node.nodes = [{ type: 'string', quote: '"', value: `${FONT_ORIGIN}/${index}` }];
        return false;
      });
      declaration.value = parsed.toString();
    });
  });
}
