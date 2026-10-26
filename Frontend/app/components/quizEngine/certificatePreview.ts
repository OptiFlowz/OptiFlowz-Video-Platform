import type { CertificateTemplateInput } from './certificateApi';
import { certificateQrPreview } from './certificateQrPreview';

export const certificatePreviewData: Record<string, string> = {
  'user.full_name': 'John Anderson',
  'quiz.title': 'Workplace Health and Safety Fundamentals',
  'result.score_percentage': '95',
  'result.earned_points': '19',
  'result.max_points': '20',
  'certificate.number': 'CERT-2026-000001',
  'certificate.issued_at': 'October 23, 2026',
};
export function certificatePaper(template: Pick<CertificateTemplateInput, 'page_format' | 'orientation'>) {
  const [short, long] = template.page_format === 'Letter' ? [816, 1056] : [210 * 96 / 25.4, 297 * 96 / 25.4];
  return template.orientation === 'landscape' ? { width: long, height: short } : { width: short, height: long };
}

// Static SVG elements and attributes match the backend certificate allowlist.
const svgTags = new Set(`svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath
  title desc linearGradient radialGradient stop clipPath mask pattern marker filter feGaussianBlur feOffset
  feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feMorphology`.split(/\s+/));
const svgAttrs = new Set(`id class style role aria-label aria-hidden aria-labelledby aria-describedby xmlns xmlns:xlink xml:space version focusable
  width height x y x1 x2 y1 y2 cx cy r rx ry dx dy d points pathLength viewBox preserveAspectRatio
  transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin
  stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color vector-effect paint-order
  font-family font-size font-weight font-style letter-spacing word-spacing text-anchor dominant-baseline
  alignment-baseline textLength lengthAdjust rotate startOffset method spacing
  gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity fx fy fr
  clip-path clip-rule clipPathUnits mask maskUnits maskContentUnits mask-type
  patternUnits patternContentUnits patternTransform marker-start marker-mid marker-end markerWidth markerHeight
  markerUnits refX refY orient href xlink:href filter filterUnits primitiveUnits stdDeviation
  in in2 result type values mode operator k1 k2 k3 k4 flood-color flood-opacity color-interpolation-filters radius
  shape-rendering text-rendering color-interpolation overflow enable-background`.split(/\s+/));
const svgNamespace = 'http://www.w3.org/2000/svg';
const localReference = /^#[\w-]+$/;

function cleanSvg(element: Element) {
  if (!svgTags.has(element.localName) || element.namespaceURI !== svgNamespace) {
    element.remove();
    return;
  }
  for (const attr of Array.from(element.attributes)) {
    if (!svgAttrs.has(attr.name)
      || (['href', 'xlink:href'].includes(attr.name) && !localReference.test(attr.value))) {
      element.removeAttribute(attr.name);
    }
  }
}

function googleStylesheet(value: string) {
  try {
    const url = new URL(value);
    return url.origin === 'https://fonts.googleapis.com' && !url.username && !url.password
      && !url.hash && ['/css', '/css2'].includes(url.pathname);
  } catch { return false; }
}

// Embedded SVG is parsed separately: no scripts, foreignObject, animation or external references.
function svgImage(value: string): string | null {
  const match = /^data:image\/svg\+xml(?:;charset=utf-8)?(;base64)?,([\s\S]+)$/i.exec(value);
  if (!match) return null;
  try {
    const xml = match[1]
      ? new TextDecoder().decode(Uint8Array.from(atob(match[2]), character => character.charCodeAt(0)))
      : decodeURIComponent(match[2]);
    if (new TextEncoder().encode(xml).length > 100 * 1024 || /<!DOCTYPE|<\?|\{\{|\}\}/i.test(xml)) return null;
    const parsed = new window.DOMParser().parseFromString(xml, 'image/svg+xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') return null;
    const elements = Array.from(parsed.querySelectorAll('*'));
    if (elements.length > 5000) return null;
    for (const element of elements) cleanSvg(element);
    if (!parsed.documentElement || parsed.documentElement.namespaceURI !== svgNamespace) return null;
    return `data:image/svg+xml,${encodeURIComponent(new window.XMLSerializer().serializeToString(parsed.documentElement))}`;
  } catch { return null; }
}

// Parse in an inert template, never in the application's live DOM. The iframe
// stays sandboxed; only font resources may use HTTPS. Saving uses backend validation.
export function certificateHtmlDocument(template: CertificateTemplateInput, qrImages: Record<string, string> = {}, options: { values?: Record<string, string>; sampleQr?: boolean } = {}): string {
  if (typeof document === 'undefined') return '';
  const fragment = document.createElement('template');
  fragment.innerHTML = template.html_template;
  const tags = new Set('div span p br hr h1 h2 h3 h4 h5 h6 strong em b i u s small sub sup section article header footer main aside figure figcaption blockquote pre code ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td img a'.split(' '));
  const attrs = new Set('id class title lang dir style role aria-label aria-hidden alt width height colspan rowspan scope span start reversed type value'.split(' '));
  for (const element of Array.from(fragment.content.querySelectorAll('*'))) {
    if (element.namespaceURI === svgNamespace) { cleanSvg(element); continue; }
    if (element.localName === 'link') {
      const href = element.getAttribute('href') ?? '';
      if (element.getAttribute('rel') !== 'stylesheet' || !googleStylesheet(href)) { element.remove(); continue; }
      for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
      element.setAttribute('rel', 'stylesheet');
      element.setAttribute('href', href);
      element.setAttribute('crossorigin', 'anonymous');
      element.setAttribute('referrerpolicy', 'no-referrer');
      continue;
    }
    if (!tags.has(element.localName)) { element.remove(); continue; }
    const source = element.getAttribute('src') ?? '';
    // Issued certificates must never display the sample verification QR.
    if (element.localName === 'img' && options.sampleQr === false && !qrImages[source] && source.includes('certificate.qr_code_data_uri')) { element.remove(); continue; }
    const image = element.localName === 'img'
      ? (qrImages[source] ?? (/^\{\{\s*certificate\.qr_code_data_uri\s*\}\}$/.test(source) ? certificateQrPreview : svgImage(source)))
      : null;
    for (const attribute of Array.from(element.attributes)) {
      if (!attrs.has(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (image) element.setAttribute('src', image);
  }
  const walker = document.createTreeWalker(fragment.content, 4 /* SHOW_TEXT */);
  while (walker.nextNode()) {
    walker.currentNode.textContent = (walker.currentNode.textContent ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name) => (options.values ?? certificatePreviewData)[name] ?? match);
  }
  const { width, height } = certificatePaper(template);
  // Escaping '<' prevents template CSS from closing its style element.
  const css = template.css_template.replace(/</g, '\\3c ');
  const dimensions = `width:${width}px!important;height:${height}px!important;min-width:0!important;min-height:0!important;max-width:${width}px!important;max-height:${height}px!important`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com/css https://fonts.googleapis.com/css2; img-src data:; font-src data: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0!important;padding:0!important;${dimensions};overflow:hidden!important}body{font-family:Arial,sans-serif}.certificate,.certificate *{box-sizing:border-box}</style><style>${css}</style></head><body><div class="certificate" style="${dimensions};box-sizing:border-box!important;margin:0!important;position:relative!important;overflow:hidden!important;contain:strict!important">${fragment.innerHTML}</div></body></html>`;
}
