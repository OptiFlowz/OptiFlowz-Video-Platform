import postcss from 'postcss';
import prefixSelector from 'postcss-prefix-selector';
import selectorParser from 'postcss-selector-parser';
import { HttpError } from '../../../../common/httpError.js';
import { normalizeTemplateHtml, validateTemplateContent } from './templateContent.validation.js';
import { fillPreviewPlaceholders } from './templatePlaceholders.js';

const PAPER_SIZES = { A4: [210, 297], Letter: [215.9, 279.4] };
export const PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function buildPreviewDocument(template) {
  const { html_template, css_template, page_format, orientation } = template;
  if (!Object.hasOwn(PAPER_SIZES, page_format) || !['portrait', 'landscape'].includes(orientation)) {
    throw new HttpError(422, { message: 'Invalid stored page format or orientation', field: 'page_format' });
  }
  if (typeof html_template !== 'string' || typeof css_template !== 'string') {
    throw new HttpError(422, { message: 'Stored HTML and CSS must be strings', field: 'html_template' });
  }
  validateTemplateContent({ html_template, css_template });
  const html = normalizeTemplateHtml(fillPreviewPlaceholders(normalizeTemplateHtml(html_template)));
  let css;
  try {
    css = postcss([prefixSelector({
      prefix: '.certificate',
      transform(prefix, selector) {
        // Match the subject only within the wrapper, even for sibling combinators or :has().
        // Keep wrapper styles working without producing `.certificate .certificate` exclusively.
        const local = selector.replace(/^(?:html\s+body|:root\s+body|html|body|:root)(?=[\s.#:[>+~]|$)/i, prefix);
        const parsed = selectorParser().astSync(local).first;
        const pseudoIndex = parsed.nodes.findIndex(node => node.type === 'pseudo'
          && (/^::/.test(node.value) || /^:(before|after|first-line|first-letter)$/i.test(node.value)));
        // Pseudo-elements cannot appear inside :is(); keep them on the scoped subject.
        let suffix = '';
        if (pseudoIndex !== -1) {
          const tail = parsed.nodes.slice(pseudoIndex);
          if (tail.some(node => node.type === 'combinator')) throw new Error('Invalid pseudo-element selector');
          suffix = tail.map(node => node.toString()).join('');
          for (const node of tail) node.remove();
        }
        const subject = parsed.toString() || '*';
        return `${prefix}:is(${subject})${suffix}, ${prefix} :is(${subject})${suffix}`;
      },
    })]).process(css_template, { from: undefined }).css;
  } catch {
    throw new HttpError(422, { message: 'css_template: Unable to scope CSS selectors', field: 'css_template' });
  }
  const [short, long] = PAPER_SIZES[page_format];
  const [width, height] = orientation === 'landscape' ? [long, short] : [short, long];
  const dimensions = `width:${width}mm!important;height:${height}mm!important;min-width:0!important;min-height:0!important;max-width:${width}mm!important;max-height:${height}mm!important`;
  const document = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">
<title>Certificate preview</title>
<style>
html, body { margin:0!important; padding:0!important; ${dimensions}; overflow:hidden!important; }
body { font-family:Arial,sans-serif; }
.certificate, .certificate * { box-sizing:border-box; }
${css}
@page { size:${page_format} ${orientation}!important; margin:0!important; }
</style></head><body><div class="certificate" style="${dimensions};box-sizing:border-box!important;margin:0!important;position:relative!important;overflow:hidden!important;contain:strict!important;page:auto!important;break-before:auto!important;break-after:auto!important">${html}</div></body></html>`;
  return { html: document, format: page_format, landscape: orientation === 'landscape' };
}
