import type { CertificateTemplateInput } from './certificateApi';

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

// Parse in an inert template, never in the application's live DOM. This preview
// is deliberately offline and sandboxed; saving still uses backend validation.
export function certificateHtmlDocument(template: CertificateTemplateInput): string {
  if (typeof document === 'undefined') return '';
  const fragment = document.createElement('template');
  fragment.innerHTML = template.html_template;
  const tags = new Set('div span p br hr h1 h2 h3 h4 h5 h6 strong em b i u s small sub sup section article header footer main aside figure figcaption blockquote pre code ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td img a'.split(' '));
  const attrs = new Set('id class title lang dir style role aria-label aria-hidden alt width height colspan rowspan scope span start reversed type value'.split(' '));
  for (const element of Array.from(fragment.content.querySelectorAll('*'))) {
    if (!tags.has(element.localName)) { element.remove(); continue; }
    for (const attribute of Array.from(element.attributes)) {
      if (!attrs.has(attribute.name)) element.removeAttribute(attribute.name);
    }
  }
  const walker = document.createTreeWalker(fragment.content, 4 /* SHOW_TEXT */);
  while (walker.nextNode()) {
    walker.currentNode.textContent = (walker.currentNode.textContent ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name) => certificatePreviewData[name] ?? match);
  }
  const { width, height } = certificatePaper(template);
  // Escaping '<' prevents template CSS from closing its style element.
  const css = template.css_template.replace(/</g, '\\3c ');
  const dimensions = `width:${width}px!important;height:${height}px!important;min-width:0!important;min-height:0!important;max-width:${width}px!important;max-height:${height}px!important`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0!important;padding:0!important;${dimensions};overflow:hidden!important}body{font-family:Arial,sans-serif}.certificate,.certificate *{box-sizing:border-box}${css}</style></head><body><div class="certificate" style="${dimensions};box-sizing:border-box!important;margin:0!important;position:relative!important;overflow:hidden!important;contain:strict!important">${fragment.innerHTML}</div></body></html>`;
}
