import sanitizeHtml from 'sanitize-html';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { SaxesParser } from 'saxes';
import { HttpError } from '../../../../common/httpError.js';
import { validatePlaceholders, rejectAttributePlaceholders, isQrCodePlaceholder } from './templatePlaceholders.js';
import { decodeCssEscapes, decodeBase64, httpsResourceUrl, googleFontStylesheet, fontImportUrl, validateEmbeddedFont } from './certificateResources.js';

export const MAX_TEMPLATE_BYTES = 1024 * 1024;

const tags = new Set(`div span p br hr h1 h2 h3 h4 h5 h6 strong em b i u s small sub sup
  section article header footer main aside figure figcaption blockquote pre code
  ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td img a link`.split(/\s+/));
const attributes = {
  '*': ['id', 'class', 'title', 'lang', 'dir', 'style', 'role', 'aria-label', 'aria-hidden'],
  a: ['href'], img: ['src', 'alt', 'width', 'height'],
  link: ['rel', 'href', 'crossorigin'],
  th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'],
  col: ['span', 'width'], colgroup: ['span'], ol: ['start', 'reversed', 'type'], li: ['value'],
};
const svgNames = `svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath
  title desc linearGradient radialGradient stop clipPath mask pattern marker filter feGaussianBlur feOffset
  feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feMorphology`.split(/\s+/);
const svgTags = new Map(svgNames.map(name => [name.toLowerCase(), name]));
const svgAttributeNames = `id class style role aria-label aria-hidden aria-labelledby aria-describedby xmlns xmlns:xlink xml:space version focusable
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
  shape-rendering text-rendering color-interpolation overflow enable-background`.split(/\s+/);
const svgAttributes = new Map(svgAttributeNames.map(name => [name.toLowerCase(), name]));
const svgValues = new Set(`fill stroke clip-path mask filter marker-start marker-mid marker-end`.split(' '));
const sanitizerAttributes = { ...attributes };
for (const name of svgNames) sanitizerAttributes[name] = svgAttributeNames;
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
  fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin
  stroke-miterlimit stroke-dasharray stroke-dashoffset clip-rule vector-effect paint-order
  text-anchor dominant-baseline alignment-baseline stop-color stop-opacity flood-color flood-opacity color-interpolation-filters mask mask-image mask-size
  mask-position mask-repeat mask-mode mask-type marker-start marker-mid marker-end shape-rendering text-rendering color-interpolation
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

const decodeEscapes = decodeCssEscapes;

function validateUrl(value, field, allowFragment = false, resource = 'image') {
  if (allowFragment && /^#[\w-]+$/.test(value)) return;
  if (resource === 'fragment') fail(field, 'SVG references must be local #fragment references');
  if (/^data:/i.test(value)) {
    if (resource === 'font') validateEmbeddedFont(value, field);
    else if (resource === 'image') validateSvgData(value, field);
    else fail(field, 'Data URLs are not allowed here');
    return;
  }
  httpsResourceUrl(value, field);
}

function validateValue(value, field, resource = 'image') {
  // Removing comments before inspection also detects split/escaped function names.
  const parsed = valueParser(value.replace(/\/\*[\s\S]*?\*\//g, ''));
  parsed.walk(node => {
    if (node.unclosed) fail(field, 'Unclosed CSS function or string');
    if (node.type !== 'function') return;
    const name = decodeEscapes(node.value).toLowerCase();
    if (name === 'url') {
      const parts = node.nodes.filter(part => part.type !== 'space' && part.type !== 'comment');
      if (parts.length !== 1 || !['string', 'word'].includes(parts[0].type)) fail(field, 'Invalid CSS URL');
      validateUrl(decodeEscapes(parts[0].value), field, resource !== 'font', resource);
      return false;
    }
    if (name !== '' && !functions.has(name)) fail(field, `CSS function "${name}" is not allowed`);
  });
}

function validateCss(css, field, inline = false, svg = false) {
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
    if (name === 'import' && !inline && node.parent.type === 'root' && !node.nodes) {
      fontImportUrl(node.params, field);
      return;
    }
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
    validateValue(node.value, field, svg ? 'fragment' : fontFace && property === 'src' ? 'font' : 'image');
  });
}

function validateSvgAttributes(tag, attrs, field) {
  for (const [attribute, value] of Object.entries(attrs)) {
    const lower = attribute.toLowerCase();
    rejectAttributePlaceholders(value);
    if (!svgAttributes.has(lower)) fail(field, `Attribute "${attribute}" is not allowed on <${tag}>`);
    if (lower === 'xmlns' && value !== 'http://www.w3.org/2000/svg') fail(field, 'Invalid SVG namespace');
    if (lower === 'xmlns:xlink' && value !== 'http://www.w3.org/1999/xlink') fail(field, 'Invalid XLink namespace');
    if (lower === 'href' || lower === 'xlink:href') validateUrl(value, field, true, 'fragment');
    if (lower === 'style') validateCss(value, field, true, true);
    if (svgValues.has(lower)) validateValue(value, field, 'fragment');
  }
}

function validateSvgData(value, field) {
  const match = /^data:image\/svg\+xml(?:;charset=utf-8)?(;base64)?,([\s\S]+)$/i.exec(value);
  if (!match) fail(field, 'Only SVG data images are supported');
  let xml;
  try { xml = match[1] ? decodeBase64(match[2], field).toString('utf8') : decodeURIComponent(match[2]); }
  catch { fail(field, 'Invalid SVG data encoding'); }
  if (Buffer.byteLength(xml) > 100 * 1024) fail(field, 'SVG images exceed the 100 KiB limit');
  if (/\{\{|\}\}/.test(xml)) fail(field, 'Placeholders are not supported inside SVG data images');
  const parser = new SaxesParser();
  let depth = 0, count = 0;
  parser.on('doctype', () => fail(field, 'SVG DOCTYPE is not allowed'));
  parser.on('processinginstruction', () => fail(field, 'SVG processing instructions are not allowed'));
  parser.on('error', () => fail(field, 'Invalid SVG XML'));
  parser.on('opentag', node => {
    if (++count > 5000 || ++depth > 64) fail(field, 'SVG exceeds the complexity limit');
    if ((depth === 1 && node.name !== 'svg') || !svgNames.includes(node.name)) fail(field, `SVG element <${node.name}> is not allowed`);
    if (Object.keys(node.attributes).some(name => !svgAttributeNames.includes(name))) fail(field, 'Invalid SVG attribute');
    validateSvgAttributes(node.name, node.attributes, field);
  });
  parser.on('closetag', () => { depth--; });
  parser.write(xml).close();
}

function validateFontLink(attrs, field) {
  if (attrs.rel === 'stylesheet') googleFontStylesheet(attrs.href || '', field);
  else if (attrs.rel === 'preconnect') {
    const url = httpsResourceUrl(attrs.href || '', field);
    if (!['https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'].includes(url.href)) fail(field, 'Only Google Fonts preconnect links are supported');
  } else fail(field, 'Only Google Fonts stylesheet/preconnect links are supported');
  if (attrs.crossorigin !== undefined && !['', 'anonymous'].includes(attrs.crossorigin)) fail(field, 'Font links cannot include credentials');
}

function validateHtml(html, onFontStylesheet) {
  const field = 'html_template';
  const originalAttributes = new WeakMap();
  let depth = 0;
  let nodeCount = 0;
  const svgStack = [];
  const options = {
    allowedTags: [...tags, ...svgNames], allowedAttributes: sanitizerAttributes,
    allowedEmptyAttributes: [...new Set(Object.values(sanitizerAttributes).flat())],
    allowedSchemes: ['https'], allowedSchemesByTag: { img: ['https', 'data'] }, allowProtocolRelative: false,
    parseStyleAttributes: false,
    transformTags: { '*': (tag, attrs) => {
      if (!svgTags.has(tag.toLowerCase())) return { tagName: tag, attribs: attrs };
      for (const name of Object.keys(attrs)) {
        const canonical = svgAttributes.get(name.toLowerCase());
        if (canonical && canonical !== name) { attrs[canonical] = attrs[name]; delete attrs[name]; }
      }
      originalAttributes.set(attrs, { ...attrs });
      return { tagName: svgTags.get(tag.toLowerCase()), attribs: attrs };
    } },
    onOpenTag(tag, attrs) {
      if (++depth > 64 || ++nodeCount > 5000) fail(field, 'HTML exceeds the complexity limit');
      const inSvg = tag === 'svg' || svgStack.at(-1) === true;
      svgStack.push(inSvg);
      if (inSvg) {
        if (!svgTags.has(tag.toLowerCase())) fail(field, `SVG element <${tag}> is not allowed`);
        validateSvgAttributes(tag, attrs, field);
        originalAttributes.set(attrs, { ...attrs });
        return;
      }
      if (!tags.has(tag)) fail(field, `HTML element <${tag}> is not allowed`);
      if (tag === 'link') validateFontLink(attrs, field);
      originalAttributes.set(attrs, { ...attrs });
      for (const [attribute, value] of Object.entries(attrs)) {
        if (tag === 'img' && attribute === 'src' && isQrCodePlaceholder(value)) continue;
        rejectAttributePlaceholders(value);
        if (!attributes['*'].includes(attribute) && !(attributes[tag] || []).includes(attribute)) {
          fail(field, `Attribute "${attribute}" is not allowed on <${tag}>`);
        }
        if (attribute === 'style') validateCss(value, field, true);
        if (attribute === 'src' || attribute === 'href') validateUrl(value, field, attribute === 'href', attribute === 'src' ? 'image' : 'link');
      }
    },
    onCloseTag() { depth = Math.max(0, depth - 1); svgStack.pop(); },
    textFilter(text) {
      // Entity-encoded braces must obey the same allowlist as literal placeholders.
      validatePlaceholders(text);
      return text;
    },
    exclusiveFilter(frame) {
      if (frame.tag === 'link' && onFontStylesheet) {
        if (frame.attribs.rel === 'stylesheet') onFontStylesheet(googleFontStylesheet(frame.attribs.href));
        return true;
      }
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
  // Entity-encoded braces can arrive in separate textFilter chunks. Check the joined,
  // canonical HTML too, masking only img src values already accepted above.
  validatePlaceholders(normalizedHtml.replace(
    /(<img\b[^>]*\ssrc=")\{\{\s*certificate\.qr_code_data_uri\s*\}\}("[^>]*>)/g, '$1$2',
  ));
  // An unfinished tag, attribute, or comment must not absorb markup appended by a renderer.
  const boundary = 'certificate-validation-boundary';
  let reachedBoundary = false;
  depth = 0;
  nodeCount = 0;
  svgStack.length = 0;
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
    if (Buffer.byteLength(template.html_template) > MAX_TEMPLATE_BYTES) fail('html_template', 'HTML exceeds the 1 MiB limit');
    validatePlaceholders(template.html_template, 'html_template', true);
    // Comments and declarations are discarded by the sanitizer, not valid QR contexts.
    for (const ignored of template.html_template.match(/<!(?:--[\s\S]*?(?:-->|$)|[^>]*>)|<\?[^>]*>/g) || []) {
      validatePlaceholders(ignored);
    }
    validateHtml(template.html_template);
  }
  if (template.css_template !== undefined) {
    if (typeof template.css_template !== 'string') fail('css_template', 'CSS template must be a string');
    if (Buffer.byteLength(template.css_template) > MAX_TEMPLATE_BYTES) fail('css_template', 'CSS exceeds the 1 MiB limit');
    validatePlaceholders(template.css_template, 'css_template');
    validateCss(template.css_template, 'css_template');
  }
  return template;
}

// Balance fragments for embedding so stray closing tags cannot escape the certificate wrapper.
// Stored source remains unchanged; normalization is only used to build the render document.
export function normalizeTemplateHtml(html, onFontStylesheet) {
  validateTemplateContent({ html_template: html });
  return validateHtml(html, onFontStylesheet);
}
