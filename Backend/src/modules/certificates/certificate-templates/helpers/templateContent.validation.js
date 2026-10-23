import sanitizeHtml from 'sanitize-html';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { HttpError } from '../../../../common/httpError.js';
import { validatePlaceholders, rejectAttributePlaceholders } from './templatePlaceholders.js';

export const MAX_TEMPLATE_BYTES = 100 * 1024;

const tags = new Set(`div span p br hr h1 h2 h3 h4 h5 h6 strong em b i u s small sub sup
  section article header footer main aside figure figcaption blockquote pre code
  ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td img a`.split(/\s+/));
const attributes = {
  '*': ['id', 'class', 'title', 'lang', 'dir', 'style', 'role', 'aria-label', 'aria-hidden'],
  a: ['href'], img: ['src', 'alt', 'width', 'height'],
  th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'],
  col: ['span', 'width'], colgroup: ['span'], ol: ['start', 'reversed', 'type'], li: ['value'],
};
const properties = new Set(`
  display visibility opacity pointer-events box-sizing position top right bottom left inset inset-inline inset-block
  inset-inline-start inset-inline-end inset-block-start inset-block-end z-index float clear isolation
  width height min-width max-width min-height max-height inline-size block-size min-inline-size max-inline-size
  min-block-size max-block-size aspect-ratio overflow overflow-x overflow-y overflow-wrap
  margin margin-top margin-right margin-bottom margin-left margin-inline margin-block
  margin-inline-start margin-inline-end margin-block-start margin-block-end
  padding padding-top padding-right padding-bottom padding-left padding-inline padding-block
  padding-inline-start padding-inline-end padding-block-start padding-block-end
  border border-width border-style border-color border-top border-right border-bottom border-left
  border-top-width border-right-width border-bottom-width border-left-width
  border-top-style border-right-style border-bottom-style border-left-style
  border-top-color border-right-color border-bottom-color border-left-color
  border-radius border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius
  border-collapse border-spacing outline outline-width outline-style outline-color outline-offset box-shadow
  background background-color background-image background-size background-position background-repeat
  background-origin background-clip background-attachment background-blend-mode
  color font font-family font-size font-weight font-style font-stretch font-variant font-variant-caps
  font-variant-numeric font-feature-settings font-kerning font-optical-sizing font-variation-settings
  line-height letter-spacing word-spacing text-align text-align-last text-indent text-transform
  text-decoration text-decoration-line text-decoration-color text-decoration-style text-decoration-thickness
  text-underline-offset text-shadow text-overflow text-wrap white-space word-break hyphens vertical-align
  direction unicode-bidi writing-mode text-orientation
  flex flex-direction flex-wrap flex-flow flex-grow flex-shrink flex-basis order
  justify-content justify-items justify-self align-content align-items align-self place-content place-items place-self
  gap row-gap column-gap grid grid-template grid-template-columns grid-template-rows grid-template-areas
  grid-auto-columns grid-auto-rows grid-auto-flow grid-column grid-column-start grid-column-end
  grid-row grid-row-start grid-row-end grid-area
  object-fit object-position transform transform-origin transform-style translate rotate scale
  perspective perspective-origin backface-visibility filter backdrop-filter mix-blend-mode clip-path
  list-style list-style-type list-style-position list-style-image table-layout caption-side empty-cells
  content counter-reset counter-increment counter-set quotes
  columns column-count column-width column-fill column-span column-rule column-rule-width column-rule-style column-rule-color
  break-before break-after break-inside page-break-before page-break-after page-break-inside orphans widows
  print-color-adjust -webkit-print-color-adjust size page
`.trim().split(/\s+/));
const fontDescriptors = new Set(['font-family', 'font-style', 'font-weight', 'font-stretch', 'font-display', 'src', 'unicode-range']);
const functions = new Set(`var calc min max clamp env rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix
  linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient
  repeat minmax fit-content translate translatex translatey translatez translate3d scale scalex scaley scalez scale3d
  rotate rotatex rotatey rotatez rotate3d skew skewx skewy matrix matrix3d perspective
  blur brightness contrast drop-shadow grayscale hue-rotate invert opacity saturate sepia
  inset circle ellipse polygon path counter counters symbols local format tech`.split(/\s+/));

function fail(field, message) {
  throw new HttpError(422, { message: `${field}: ${message}`, field });
}

function decodeEscapes(value) {
  return value.replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\r\n\f])/gi, (_, hex, character) => {
    if (!hex) return character;
    const code = parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
  });
}

function validateUrl(value, field, allowFragment = false) {
  if (allowFragment && /^#[\w-]+$/.test(value)) return;
  if (!/^https:\/\//i.test(value) || /[\s\u0000-\u001f\u007f\\]/.test(value)) {
    fail(field, 'Resource URLs must be absolute HTTPS URLs');
  }
  try {
    const url = new URL(value);
    if (!url.hostname || url.username || url.password) fail(field, 'URL credentials are not allowed');
  } catch (error) {
    if (error.status === 422) throw error;
    fail(field, 'Invalid resource URL');
  }
}

function validateValue(value, field) {
  // Removing comments before inspection also detects split/escaped function names.
  const parsed = valueParser(value.replace(/\/\*[\s\S]*?\*\//g, ''));
  parsed.walk(node => {
    if (node.unclosed) fail(field, 'Unclosed CSS function or string');
    if (node.type !== 'function') return;
    const name = decodeEscapes(node.value).toLowerCase();
    if (name === 'url') {
      const parts = node.nodes.filter(part => part.type !== 'space' && part.type !== 'comment');
      if (parts.length !== 1 || !['string', 'word'].includes(parts[0].type)) fail(field, 'Invalid CSS URL');
      validateUrl(decodeEscapes(parts[0].value), field, true);
      return false;
    }
    if (name !== '' && !functions.has(name)) fail(field, `CSS function "${name}" is not allowed`);
  });
}

function validateCss(css, field, inline = false) {
  // CSS is eventually embedded in a style element. HTML end tags must never escape it.
  if (/[<\u0000]/.test(css)) fail(field, 'HTML markup and null characters are not allowed in CSS');
  let root;
  try { root = postcss.parse(inline ? `template {${css}}` : css, { from: undefined }); }
  catch (error) {
    if (error.name !== 'CssSyntaxError') throw error;
    fail(field, `Invalid CSS syntax: ${error.reason} (line ${error.line}, column ${error.column})`);
  }
  // Bound traversal before PostCSS's recursive walkers run on stored/untrusted input.
  const pending = [{ node: root, depth: 0 }];
  let nodeCount = 0;
  while (pending.length) {
    const { node, depth } = pending.pop();
    if (++nodeCount > 5000 || depth > 64) fail(field, 'CSS exceeds the complexity limit');
    for (const child of node.nodes || []) pending.push({ node: child, depth: depth + 1 });
  }
  if (inline && (root.nodes.length !== 1 || root.first.type !== 'rule' || root.first.selector !== 'template'
    || root.first.nodes.some(node => !['decl', 'comment'].includes(node.type)))) {
    fail(field, 'Inline styles may only contain declarations');
  }
  root.walkAtRules(node => {
    const name = node.name.toLowerCase();
    if (!['media', 'supports', 'page', 'font-face'].includes(name) || !node.nodes) {
      fail(field, `CSS at-rule "@${node.name}" is not allowed`);
    }
    validateValue(node.params, field);
  });
  root.walkDecls(node => {
    const property = decodeEscapes(node.prop).toLowerCase();
    const fontFace = node.parent.type === 'atrule' && node.parent.name.toLowerCase() === 'font-face';
    if (!(fontFace ? fontDescriptors.has(property) : properties.has(property) || /^--[a-z0-9_-]+$/i.test(property))) {
      fail(field, `CSS property "${node.prop}" is not allowed`);
    }
    if (node.parent.type === 'root' || !node.value.trim()) fail(field, 'CSS declarations require a rule and a nonempty value');
    validateValue(node.value, field);
  });
}

function validateHtml(html) {
  const field = 'html_template';
  const originalAttributes = new WeakMap();
  let depth = 0;
  let nodeCount = 0;
  const options = {
    allowedTags: [...tags], allowedAttributes: attributes,
    allowedEmptyAttributes: [...new Set(Object.values(attributes).flat())],
    allowedSchemes: ['https'], allowProtocolRelative: false,
    parseStyleAttributes: false,
    onOpenTag(tag, attrs) {
      if (++depth > 64 || ++nodeCount > 5000) fail(field, 'HTML exceeds the complexity limit');
      if (!tags.has(tag)) fail(field, `HTML element <${tag}> is not allowed`);
      originalAttributes.set(attrs, { ...attrs });
      for (const [attribute, value] of Object.entries(attrs)) {
        rejectAttributePlaceholders(value);
        if (!attributes['*'].includes(attribute) && !(attributes[tag] || []).includes(attribute)) {
          fail(field, `Attribute "${attribute}" is not allowed on <${tag}>`);
        }
        if (attribute === 'style') validateCss(value, field, true);
        if (attribute === 'src' || attribute === 'href') validateUrl(value, field, attribute === 'href');
      }
    },
    onCloseTag() { depth = Math.max(0, depth - 1); },
    textFilter(text) {
      // Entity-encoded braces must obey the same allowlist as literal placeholders.
      validatePlaceholders(text);
      return text;
    },
    exclusiveFilter(frame) {
      // Detect sanitizer removals without comparing serialization (quotes, entities, casing).
      const original = originalAttributes.get(frame.attribs);
      for (const [attribute, value] of Object.entries(original || {})) {
        // Class whitespace is normalized by sanitize-html even when every class is allowed.
        if (attribute === 'class') continue;
        if (frame.attribs[attribute] !== value) fail(field, `Unsafe value for attribute "${attribute}"`);
      }
      return false;
    },
  };
  const normalizedHtml = sanitizeHtml(html, options);
  validatePlaceholders(normalizedHtml);
  // An unfinished tag, attribute, or comment must not absorb markup appended by a renderer.
  const boundary = 'certificate-validation-boundary';
  let reachedBoundary = false;
  depth = 0;
  nodeCount = 0;
  sanitizeHtml(`${html}<${boundary}></${boundary}>`, {
    ...options,
    onOpenTag(tag, attrs) {
      if (tag === boundary && Object.keys(attrs).length === 0) reachedBoundary = true;
      else options.onOpenTag(tag, attrs);
    },
  });
  if (!reachedBoundary) fail(field, 'Unclosed HTML tag, attribute, or comment');
  return normalizedHtml;
}

// The single content gate for creation, partial updates, and preview/render handlers.
// It validates supplied fields and preserves the exact accepted source; it never sanitizes in place.
export function validateTemplateContent(template) {
  if (template.html_template !== undefined) {
    if (typeof template.html_template !== 'string' || !template.html_template.trim()) fail('html_template', 'HTML template must not be empty');
    if (Buffer.byteLength(template.html_template) > MAX_TEMPLATE_BYTES) fail('html_template', 'HTML exceeds the 100 KiB limit');
    validatePlaceholders(template.html_template);
    validateHtml(template.html_template);
  }
  if (template.css_template !== undefined) {
    if (typeof template.css_template !== 'string') fail('css_template', 'CSS template must be a string');
    if (Buffer.byteLength(template.css_template) > MAX_TEMPLATE_BYTES) fail('css_template', 'CSS exceeds the 100 KiB limit');
    validatePlaceholders(template.css_template, 'css_template');
    validateCss(template.css_template, 'css_template');
  }
  return template;
}

// Balance fragments for embedding so stray closing tags cannot escape the certificate wrapper.
// Stored source remains unchanged; normalization is only used to build the render document.
export function normalizeTemplateHtml(html) {
  validateTemplateContent({ html_template: html });
  return validateHtml(html);
}
